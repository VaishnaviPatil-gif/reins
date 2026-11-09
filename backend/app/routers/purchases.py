"""
Purchases router — the core interception layer.

Every purchase attempt by an AI agent lands here:
  POST /purchases/attempt

Flow:
1. Verify mandate JWT signature & version.
2. Ensure mandate is active and vaulted with PayPal.
3. Policy Engine runs deterministic + Gemini semantic & injection tests.
4. If APPROVE  -> Charge PayPal server-side via vault_id -> log chained receipt.
5. If BLOCK    -> Record blocked attempt in chained receipt log -> return block reason.
6. If ESCALATE -> Record pending receipt -> queue human escalation -> return pending status.

Human Escalation Management:
  GET  /purchases/escalations
  POST /purchases/escalations/{id}/approve
  POST /purchases/escalations/{id}/deny
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from jose import JWTError

from app.config import get_settings
from app.database import get_db
from app.models import Mandate, Receipt, Escalation, Agent
from app.schemas import (
    PurchaseAttemptRequest,
    PurchaseAttemptResponse,
    ReceiptOut,
    EscalationOut,
    ChainVerificationResponse,
)
from app.services.mandates import verify_mandate_token
from app.services.policy import evaluate_purchase_policy
from app.services.receipts import (
    append_receipt,
    verify_receipt_chain,
    calculate_receipt_hash,
    snapshot_receipt_before_tamper,
    restore_tampered_receipts,
)
from app.services.paypal import (
    get_access_token,
    create_vaulted_order,
    capture_order,
    extract_capture_id,
    create_fallback_order,
)

settings = get_settings()
router = APIRouter(prefix="/purchases", tags=["purchases"])


@router.post("/attempt", response_model=PurchaseAttemptResponse)
async def attempt_purchase(body: PurchaseAttemptRequest, db: Session = Depends(get_db)):
    """
    Primary agent purchase endpoint.
    Agents present a signed mandate token and transaction details.
    """
    # Step 1: Cryptographic mandate token verification
    try:
        claims = verify_mandate_token(body.mandate_token)
        mandate_id = int(claims["sub"])
        agent_id = int(claims["agent_id"])
        version = int(claims["version"])
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or tampered mandate token: {exc}",
        )

    # Step 2: Retrieve mandate from database
    mandate = db.query(Mandate).filter(Mandate.id == mandate_id).first()
    if not mandate:
        raise HTTPException(status_code=404, detail="Mandate not found")

    if mandate.version != version:
        raise HTTPException(
            status_code=409,
            detail="Mandate token version mismatch. Re-issue token.",
        )

    # Step 3: Run Policy Engine
    policy = await evaluate_purchase_policy(
        mandate=mandate,
        item=body.item,
        merchant=body.merchant,
        amount=body.amount,
        currency=body.currency,
        claimed_category=body.category or "",
        evidence=body.evidence,
    )

    # Step 4: Handle Decision
    if policy.decision == "approved":
        # Ensure mandate has an active PayPal vault token or fallback is enabled
        if not mandate.vault_id and not settings.paypal_vault_fallback:
            policy.decision = "blocked"
            policy.reasons.append("Mandate has no active PayPal vault token for server-side processing")

    # Path A: APPROVED -> Execute PayPal charge (Vault or Fallback)
    if policy.decision == "approved":
        order_id = None
        capture_id = None
        approve_url = None
        try:
            token = await get_access_token()
            if mandate.vault_id:
                order_resp = await create_vaulted_order(
                    access_token=token,
                    vault_id=mandate.vault_id,
                    amount=body.amount,
                    currency=body.currency,
                    description=f"Reins Agent Purchase: {body.item}",
                )
                order_id = order_resp.get("id")

                # In some configurations, the order auto-captures; otherwise explicit capture
                if order_resp.get("status") == "COMPLETED":
                    capture_id = extract_capture_id(order_resp)
                else:
                    capture_resp = await capture_order(token, order_id)
                    capture_id = extract_capture_id(capture_resp)

                mandate.budget_spent = round(mandate.budget_spent + body.amount, 2)
            else:
                # Fallback Mode: Create PayPal order returning buyer approval link
                base = settings.public_base_url.rstrip("/")
                return_url = f"{base}/mandates/{mandate.id}/link-confirm"
                cancel_url = f"{base}/mandates/{mandate.id}/link-cancel"
                order_resp = await create_fallback_order(
                    access_token=token,
                    amount=body.amount,
                    currency=body.currency,
                    description=f"Reins Purchase (Fallback): {body.item}",
                    return_url=return_url,
                    cancel_url=cancel_url,
                )
                order_id = order_resp.get("id")
                approve_url = next(
                    (link["href"] for link in order_resp.get("links", []) if link["rel"] == "payer-action"),
                    None,
                )
                policy.reasons.append("Vault fallback active: approve_url issued for manual PayPal payment")
                mandate.budget_spent = round(mandate.budget_spent + body.amount, 2)

        except Exception as exc:
            # Payment failed at gateway -> record as blocked
            policy.decision = "blocked"
            policy.reasons.append(f"PayPal execution error: {str(exc)}")

        evidence_dict = dict(body.evidence or {})
        if approve_url:
            evidence_dict["approve_url"] = approve_url
            evidence_dict["fallback_mode"] = True

        receipt = append_receipt(
            db=db,
            mandate=mandate,
            agent_id=agent_id,
            item=body.item,
            merchant=body.merchant,
            amount=body.amount,
            currency=body.currency,
            category_claimed=body.category,
            category_verified=policy.category_verified,
            agent_plan=body.agent_plan,
            evidence=evidence_dict,
            decision=policy.decision,
            reasons=policy.reasons,
            injection_flag=policy.injection_flag,
            paypal_order_id=order_id,
            paypal_capture_id=capture_id,
        )
        db.commit()
        db.refresh(receipt)

        msg = (
            "Purchase approved and processed via PayPal Vault"
            if mandate.vault_id
            else "Purchase approved by policy engine. Approve in PayPal to complete payment (Fallback Mode)."
        ) if policy.decision == "approved" else "Payment processing failed"

        return PurchaseAttemptResponse(
            decision=policy.decision,
            receipt=ReceiptOut.model_validate(receipt),
            message=msg,
            approve_url=approve_url,
        )

    # Path B: BLOCKED -> Log blocked receipt & return details
    elif policy.decision == "blocked":
        receipt = append_receipt(
            db=db,
            mandate=mandate,
            agent_id=agent_id,
            item=body.item,
            merchant=body.merchant,
            amount=body.amount,
            currency=body.currency,
            category_claimed=body.category,
            category_verified=policy.category_verified,
            agent_plan=body.agent_plan,
            evidence=body.evidence,
            decision="blocked",
            reasons=policy.reasons,
            injection_flag=policy.injection_flag,
        )
        db.commit()
        db.refresh(receipt)

        return PurchaseAttemptResponse(
            decision="blocked",
            receipt=ReceiptOut.model_validate(receipt),
            message="Purchase blocked by policy engine",
        )

    # Path C: ESCALATED -> Log receipt & create pending human escalation
    else:
        receipt = append_receipt(
            db=db,
            mandate=mandate,
            agent_id=agent_id,
            item=body.item,
            merchant=body.merchant,
            amount=body.amount,
            currency=body.currency,
            category_claimed=body.category,
            category_verified=policy.category_verified,
            agent_plan=body.agent_plan,
            evidence=body.evidence,
            decision="escalated",
            reasons=policy.reasons,
            injection_flag=policy.injection_flag,
        )
        escalation = Escalation(
            receipt_id=receipt.id,
            status="pending",
        )
        db.add(escalation)
        db.commit()
        db.refresh(receipt)
        db.refresh(escalation)

        return PurchaseAttemptResponse(
            decision="escalated",
            receipt=ReceiptOut.model_validate(receipt),
            escalation_id=escalation.id,
            message="Purchase requires human approval",
        )


# ── Escalation Management ───────────────────────────────────────────────────

@router.get("/escalations", response_model=list[EscalationOut])
def list_escalations(status_filter: str = "pending", db: Session = Depends(get_db)):
    """List pending escalations awaiting one-tap human decision."""
    query = db.query(Escalation)
    if status_filter != "all":
        query = query.filter(Escalation.status == status_filter)
    return query.order_by(Escalation.id.desc()).all()


@router.post("/escalations/{escalation_id}/approve")
async def approve_escalation(escalation_id: int, db: Session = Depends(get_db)):
    """
    Human one-tap approve:
    Executes the vaulted charge on PayPal and marks receipt approved.
    """
    esc = db.query(Escalation).filter(Escalation.id == escalation_id).first()
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    if esc.status != "pending":
        raise HTTPException(status_code=400, detail=f"Escalation already {esc.status}")

    receipt = esc.receipt
    mandate = receipt.mandate

    order_id = None
    capture_id = None

    if mandate.vault_id:
        try:
            token = await get_access_token()
            order_resp = await create_vaulted_order(
                access_token=token,
                vault_id=mandate.vault_id,
                amount=receipt.amount,
                currency=receipt.currency,
                description=f"Reins Approved Escalation: {receipt.item}",
            )
            order_id = order_resp.get("id")
            if order_resp.get("status") == "COMPLETED":
                capture_id = extract_capture_id(order_resp)
            else:
                capture_resp = await capture_order(token, order_id)
                capture_id = extract_capture_id(capture_resp)

            mandate.budget_spent = round(mandate.budget_spent + receipt.amount, 2)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"PayPal charge failed: {exc}")

    # Mark escalation resolved
    esc.status = "approved"
    esc.resolved_at = datetime.now(timezone.utc)

    # Update receipt
    receipt.decision = "approved"
    receipt.paypal_order_id = order_id
    receipt.paypal_capture_id = capture_id
    receipt.reasons = list(receipt.reasons or []) + ["Approved by user via human escalation"]

    # Re-calculate hash for integrity
    now_iso = receipt.created_at.isoformat() if receipt.created_at.tzinfo else receipt.created_at.replace(tzinfo=timezone.utc).isoformat()
    receipt.hash = calculate_receipt_hash(
        prev_hash=receipt.prev_hash,
        mandate_id=receipt.mandate_id,
        mandate_version=receipt.mandate_version,
        agent_id=receipt.agent_id,
        item=receipt.item,
        merchant=receipt.merchant,
        amount=receipt.amount,
        currency=receipt.currency,
        decision=receipt.decision,
        injection_flag=receipt.injection_flag,
        created_at_iso=now_iso,
    )

    db.commit()
    return {"message": "Escalation approved and payment captured", "receipt_id": receipt.id}


@router.post("/escalations/{escalation_id}/deny")
def deny_escalation(escalation_id: int, db: Session = Depends(get_db)):
    """Human one-tap deny."""
    esc = db.query(Escalation).filter(Escalation.id == escalation_id).first()
    if not esc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    if esc.status != "pending":
        raise HTTPException(status_code=400, detail=f"Escalation already {esc.status}")

    receipt = esc.receipt
    esc.status = "denied"
    esc.resolved_at = datetime.now(timezone.utc)

    receipt.decision = "denied"
    receipt.reasons = list(receipt.reasons or []) + ["Denied by user via human escalation"]

    now_iso = receipt.created_at.isoformat() if receipt.created_at.tzinfo else receipt.created_at.replace(tzinfo=timezone.utc).isoformat()
    receipt.hash = calculate_receipt_hash(
        prev_hash=receipt.prev_hash,
        mandate_id=receipt.mandate_id,
        mandate_version=receipt.mandate_version,
        agent_id=receipt.agent_id,
        item=receipt.item,
        merchant=receipt.merchant,
        amount=receipt.amount,
        currency=receipt.currency,
        decision=receipt.decision,
        injection_flag=receipt.injection_flag,
        created_at_iso=now_iso,
    )

    db.commit()
    return {"message": "Escalation denied", "receipt_id": receipt.id}


# ── Receipts & Chain Integrity ──────────────────────────────────────────────

@router.get("/receipts", response_model=list[ReceiptOut])
def list_receipts(limit: int = 100, db: Session = Depends(get_db)):
    """Retrieve all receipts, newest first."""
    return (
        db.query(Receipt)
        .order_by(Receipt.id.desc())
        .limit(limit)
        .all()
    )


@router.get("/receipts/verify-chain", response_model=ChainVerificationResponse)
def verify_chain(db: Session = Depends(get_db)):
    """
    Verifies cryptographic hash chain integrity across all stored receipts.
    Detects any direct database tampering.
    """
    result = verify_receipt_chain(db)
    return ChainVerificationResponse(**result)


@router.post("/receipts/simulate-tamper")
def simulate_tamper(receipt_id: int | None = None, db: Session = Depends(get_db)):
    """
    Simulates direct database tampering on a receipt without updating its SHA-256 hash.
    Gated behind DEMO_MODE (returns 404 if disabled).
    Snapshots the original receipt state before modifying so it can be restored.
    """
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tamper simulation endpoint is disabled. Set DEMO_MODE=true to enable.",
        )

    if receipt_id:
        receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    else:
        receipt = db.query(Receipt).order_by(Receipt.id.desc()).first()

    if not receipt:
        raise HTTPException(status_code=400, detail="No receipts found to tamper with")

    # Snapshot original receipt payload before tampering
    snapshot_receipt_before_tamper(receipt)

    old_amount = receipt.amount
    # Modify amount directly in database without updating hash
    receipt.amount = round(receipt.amount + 50.00, 2)
    db.commit()

    return {
        "message": f"Simulated tamper on receipt #{receipt.id}: modified amount from ${old_amount:.2f} to ${receipt.amount:.2f} without updating SHA-256 hash.",
        "tampered_receipt_id": receipt.id,
        "original_amount": old_amount,
        "tampered_amount": receipt.amount,
    }


@router.post("/receipts/repair-chain")
@router.post("/receipts/restore")
def restore_chain(db: Session = Depends(get_db)):
    """
    Restores tampered receipt(s) to their exact original pre-tamper payload snapshot.
    Gated behind DEMO_MODE (returns 404 if disabled).
    Does NOT recompute hashes — restores the exact cryptographically signed state.
    """
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt restore endpoint is disabled. Set DEMO_MODE=true to enable.",
        )

    count = restore_tampered_receipts(db)
    return {
        "message": "Tampered receipt(s) restored to original cryptographic state from snapshot",
        "receipts_restored": count,
        "receipts_rehashed": count,
    }
