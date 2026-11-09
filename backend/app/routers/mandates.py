"""
Mandates router — the core user-facing permission system.

Endpoints:
  POST   /mandates/                    — create a mandate (returns approve_link for Link PayPal)
  GET    /mandates/                    — list mandates for the demo user
  GET    /mandates/{id}                — get a single mandate
  POST   /mandates/{id}/link-paypal    — start the PayPal vault flow (returns approve URL)
  POST   /mandates/{id}/link-confirm   — called after buyer approval; captures + stores vault_id
  DELETE /mandates/{id}/revoke         — revoke mandate + delete vault token
  GET    /mandates/agents              — list available agents (for the UI form)
"""
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Mandate, Agent, User
from app.schemas import (
    MandateCreate, MandateOut, MandateLinkStart, MandateLinkConfirm, AgentOut
)
from app.services.mandates import issue_mandate_token
from app.services.paypal import (
    get_access_token,
    create_vault_setup_order,
    capture_order,
    extract_vault_id,
    extract_capture_id,
    delete_vault_token,
    refund_capture,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/mandates", tags=["mandates"])

DEMO_USER_ID = 1  # Single demo user — no auth system needed


def _get_demo_user(db: Session) -> User:
    user = db.query(User).filter(User.id == DEMO_USER_ID).first()
    if not user:
        raise HTTPException(status_code=503, detail="Demo user not seeded. Restart the server.")
    return user


@router.get("/agents", response_model=list[AgentOut])
def list_agents(db: Session = Depends(get_db)):
    """Return agents belonging to the demo user — used to populate the mandate form."""
    return db.query(Agent).filter(Agent.user_id == DEMO_USER_ID).all()


@router.post("/", response_model=MandateOut, status_code=201)
def create_mandate(body: MandateCreate, db: Session = Depends(get_db)):
    """
    Create a mandate with spending rules.
    Status starts as 'pending_link' until the user completes the Link PayPal step.
    Token is issued immediately (even before vaulting) so the UI can display it.
    """
    user = _get_demo_user(db)
    agent = db.query(Agent).filter(
        Agent.id == body.agent_id,
        Agent.user_id == DEMO_USER_ID,
    ).first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    mandate = Mandate(
        user_id=user.id,
        agent_id=body.agent_id,
        version=1,
        budget_total=body.budget_total,
        per_purchase_cap=body.per_purchase_cap,
        escalate_above=body.escalate_above,
        allowed_categories=body.allowed_categories,
        allowed_merchants=body.allowed_merchants,
        blocked_merchants=body.blocked_merchants,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        status="pending_link",  # Becomes 'active' after Link PayPal completes
    )
    db.add(mandate)
    db.flush()  # Get mandate.id before commit

    mandate.token = issue_mandate_token(
        mandate_id=mandate.id,
        user_id=user.id,
        agent_id=body.agent_id,
        version=1,
    )
    db.commit()
    db.refresh(mandate)
    return mandate


@router.get("/", response_model=list[MandateOut])
def list_mandates(db: Session = Depends(get_db)):
    """Return all mandates for the demo user, newest first."""
    return (
        db.query(Mandate)
        .filter(Mandate.user_id == DEMO_USER_ID)
        .order_by(Mandate.created_at.desc())
        .all()
    )


@router.get("/{mandate_id}", response_model=MandateOut)
def get_mandate(mandate_id: int, db: Session = Depends(get_db)):
    mandate = db.query(Mandate).filter(
        Mandate.id == mandate_id, Mandate.user_id == DEMO_USER_ID
    ).first()
    if not mandate:
        raise HTTPException(status_code=404, detail="Mandate not found")
    return mandate


@router.post("/{mandate_id}/link-paypal", response_model=MandateLinkStart)
async def link_paypal_start(mandate_id: int, request: Request, db: Session = Depends(get_db)):
    """
    Step 1 of 2 for linking PayPal.
    Creates a $1 vault-setup order and returns the approve URL.
    The user must visit this URL in their browser and log in with the sandbox buyer account.
    """
    mandate = db.query(Mandate).filter(
        Mandate.id == mandate_id, Mandate.user_id == DEMO_USER_ID
    ).first()
    if not mandate:
        raise HTTPException(status_code=404, detail="Mandate not found")
    if mandate.status == "revoked":
        raise HTTPException(status_code=400, detail="Cannot link a revoked mandate")
    if mandate.vault_id:
        raise HTTPException(status_code=400, detail="PayPal already linked to this mandate")

    # Build return/cancel URLs pointing back to our API so we can auto-complete
    base = settings.public_base_url.rstrip("/") if settings.public_base_url else str(request.base_url).rstrip("/")
    return_url = f"{base}/mandates/{mandate_id}/link-confirm"
    cancel_url = f"{base}/mandates/{mandate_id}/link-cancel"

    access_token = await get_access_token()
    order = await create_vault_setup_order(access_token, return_url, cancel_url)

    # Store the order_id so link-confirm can capture it
    mandate.paypal_link_order_id = order["id"]
    db.commit()

    # Find the payer-action link (buyer approval URL)
    approve_url = next(
        (link["href"] for link in order.get("links", []) if link["rel"] == "payer-action"),
        None,
    )
    if not approve_url:
        raise HTTPException(status_code=502, detail="PayPal did not return an approve link")

    return MandateLinkStart(
        order_id=order["id"],
        approve_url=approve_url,
        instructions=(
            "Open approve_url in your browser. Log in with the sandbox BUYER account "
            "(not the app credentials). After approval you'll be redirected back and "
            "the vault_id will be stored automatically."
        ),
    )


@router.get("/{mandate_id}/link-confirm")
async def link_paypal_confirm(
    mandate_id: int,
    request: Request,
    token: str = "",       # PayPal appends ?token=ORDER_ID to the return_url
    db: Session = Depends(get_db),
):
    """
    Step 2 of 2 — PayPal redirects here after buyer approves.
    We validate the order token, capture the order, verify status == 'VAULTED',
    store vault_id, and mark mandate active.
    Then immediately refund the $1 setup charge so the user isn't actually charged.
    Idempotent: if the mandate is already active, returns its current state.
    Browser requests are redirected to {FRONTEND_BASE_URL}/mandates/{id}?linked=1 (or ?link_error=<code>).
    """
    frontend_base = settings.frontend_base_url.rstrip("/")
    is_browser_request = (
        "text/html" in request.headers.get("accept", "")
        or request.query_params.get("redirect") in ("1", "true")
        or request.headers.get("sec-fetch-dest") == "document"
    )

    mandate = db.query(Mandate).filter(
        Mandate.id == mandate_id, Mandate.user_id == DEMO_USER_ID
    ).first()
    if not mandate:
        if is_browser_request:
            return RedirectResponse(url=f"{frontend_base}/mandates?link_error=mandate_not_found", status_code=303)
        raise HTTPException(status_code=404, detail="Mandate not found")

    if not token:
        if is_browser_request:
            return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?link_error=missing_token", status_code=303)
        raise HTTPException(status_code=400, detail="Missing required token query parameter")

    if not mandate.paypal_link_order_id or token != mandate.paypal_link_order_id:
        if is_browser_request:
            return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?link_error=token_mismatch", status_code=303)
        raise HTTPException(
            status_code=400,
            detail=f"Token mismatch: token '{token}' does not match mandate link order ID '{mandate.paypal_link_order_id}'",
        )

    # Idempotent: if mandate is already active, return its current state or redirect
    if mandate.status == "active" and mandate.vault_id:
        if is_browser_request:
            return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?linked=1", status_code=303)
        return {
            "message": "Mandate is already active.",
            "mandate_id": mandate_id,
            "vault_id": mandate.vault_id,
            "setup_charge": "$1.00 — refunded",
        }

    order_id = token
    access_token = await get_access_token()
    capture_resp = await capture_order(access_token, order_id)
    logger.info("PayPal capture response for order %s: %s", order_id, json.dumps(capture_resp, indent=2))

    capture_id = extract_capture_id(capture_resp)
    paypal_source = capture_resp.get("payment_source", {}).get("paypal", {})
    vault_block = paypal_source.get("attributes", {}).get("vault", {})
    vault_status = vault_block.get("status")
    vault_id = vault_block.get("id")

    if vault_status != "VAULTED" or not vault_id:
        mandate.status = "pending_link"
        db.commit()
        refund_err = None
        if capture_id:
            try:
                await refund_capture(access_token, capture_id, 1.00)
            except Exception as e:
                logger.error("Failed to refund capture %s: %s", capture_id, e)
                refund_err = str(e)
        err_detail = {
            "error": "PayPal vaulting was not completed with status VAULTED.",
            "vault_status": vault_status,
            "vault_block": vault_block,
            "mandate_id": mandate_id,
        }
        if refund_err:
            err_detail["refund_error"] = refund_err
        if is_browser_request:
            return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?link_error=vault_failed", status_code=303)
        raise HTTPException(status_code=400, detail=err_detail)

    # Refund the $1 setup charge immediately upon successful vaulting
    if capture_id:
        try:
            await refund_capture(access_token, capture_id, 1.00)
        except Exception as e:
            logger.warning("Failed to refund setup charge %s: %s", capture_id, e)

    mandate.vault_id = vault_id
    mandate.status = "active"
    db.commit()

    if is_browser_request:
        return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?linked=1", status_code=303)

    return {
        "message": "PayPal linked successfully. The mandate is now active.",
        "mandate_id": mandate_id,
        "vault_id": vault_id,
        "setup_charge": "$1.00 — refunded",
    }


@router.get("/{mandate_id}/link-cancel")
def link_paypal_cancel(mandate_id: int, request: Request):
    """User cancelled the PayPal approval. Mandate stays in pending_link state."""
    frontend_base = settings.frontend_base_url.rstrip("/")
    is_browser_request = (
        "text/html" in request.headers.get("accept", "")
        or request.query_params.get("redirect") in ("1", "true")
        or request.headers.get("sec-fetch-dest") == "document"
    )
    if is_browser_request:
        return RedirectResponse(url=f"{frontend_base}/mandates/{mandate_id}?link_error=cancelled", status_code=303)
    return {"message": "PayPal linking cancelled. The mandate is not yet active.", "mandate_id": mandate_id}


@router.delete("/{mandate_id}/revoke", status_code=200)
async def revoke_mandate(mandate_id: int, db: Session = Depends(get_db)):
    """
    Revoke a mandate: mark it revoked in DB and delete the PayPal vault token.
    After this, any in-flight agent purchase attempt with this mandate will be blocked
    at the status check before PayPal is ever called.
    """
    mandate = db.query(Mandate).filter(
        Mandate.id == mandate_id, Mandate.user_id == DEMO_USER_ID
    ).first()
    if not mandate:
        raise HTTPException(status_code=404, detail="Mandate not found")
    if mandate.status == "revoked":
        return {"message": "Already revoked", "mandate_id": mandate_id}

    # Delete vault token from PayPal first; if it fails we still revoke locally
    paypal_deleted = False
    if mandate.vault_id:
        try:
            access_token = await get_access_token()
            paypal_deleted = await delete_vault_token(access_token, mandate.vault_id)
        except Exception:
            paypal_deleted = False  # Non-fatal; local revoke is what stops purchases

    mandate.status = "revoked"
    db.commit()

    return {
        "message": "Mandate revoked.",
        "mandate_id": mandate_id,
        "vault_token_deleted": paypal_deleted,
    }
