"""
Phase 6 tests — Link PayPal browser redirects, FRONTEND_BASE_URL resolution,
and PAYPAL_VAULT_FALLBACK safety net execution.
"""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import Mandate, Receipt
from app.seed import seed
from app.services.mandates import issue_mandate_token
from app.services.gemini import SemanticEvaluationResult
from app.config import get_settings

TEST_DB_URL = "sqlite:///:memory:"


@pytest.fixture(scope="function")
def test_client():
    engine = create_engine(
        TEST_DB_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as session:
        seed(session)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


# ── BROWSER REDIRECT TESTS ───────────────────────────────────────────────────

def test_link_confirm_browser_redirect_success(test_client):
    """When a browser hits link-confirm, it should redirect to FRONTEND_BASE_URL/mandates/{id}?linked=1."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    mock_order = {"id": "ORDER-P6-1", "links": [{"rel": "payer-action", "href": "https://paypal.com/approve/1"}]}
    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.create_vault_setup_order", new_callable=AsyncMock, return_value=mock_order):
        test_client.post(f"/mandates/{mid}/link-paypal")

    mock_capture = {
        "id": "ORDER-P6-1",
        "status": "COMPLETED",
        "payment_source": {"paypal": {"attributes": {"vault": {"id": "VAULT-P6-1", "status": "VAULTED"}}}},
        "purchase_units": [{"payments": {"captures": [{"id": "CAP-P6-1", "status": "COMPLETED"}]}}],
    }

    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.capture_order", new_callable=AsyncMock, return_value=mock_capture), \
         patch("app.routers.mandates.refund_capture", new_callable=AsyncMock, return_value={}):
        r = test_client.get(
            f"/mandates/{mid}/link-confirm?token=ORDER-P6-1",
            headers={"Accept": "text/html,application/xhtml+xml"},
            follow_redirects=False,
        )

    assert r.status_code == 303
    location = r.headers["location"]
    assert f"/mandates/{mid}?linked=1" in location


def test_link_confirm_browser_redirect_error(test_client):
    """When a browser visits with invalid token, it redirects with ?link_error=..."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    mock_order = {"id": "ORDER-P6-2", "links": [{"rel": "payer-action", "href": "https://paypal.com/approve/2"}]}
    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.create_vault_setup_order", new_callable=AsyncMock, return_value=mock_order):
        test_client.post(f"/mandates/{mid}/link-paypal")

    r = test_client.get(
        f"/mandates/{mid}/link-confirm?token=ORDER-WRONG",
        headers={"Accept": "text/html"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert "link_error=token_mismatch" in r.headers["location"]


def test_link_cancel_browser_redirect(test_client):
    """When user cancels PayPal approval, browser redirects with ?link_error=cancelled."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    r = test_client.get(
        f"/mandates/{mid}/link-cancel",
        headers={"Accept": "text/html"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    assert f"/mandates/{mid}?link_error=cancelled" in r.headers["location"]


# ── PAYPAL VAULT FALLBACK MODE TESTS ─────────────────────────────────────────

def test_vault_fallback_disabled_blocks_unvaulted(test_client):
    """When PAYPAL_VAULT_FALLBACK is false, an unvaulted active mandate must be blocked."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 100.0, "per_purchase_cap": 50.0,
        "allowed_categories": ["books"],
    })
    mid = create_r.json()["id"]
    token = create_r.json()["token"]

    # Mark mandate active without a vault_id
    from app.models import Mandate
    from app.database import get_db
    # Get session from dependency override
    db = next(app.dependency_overrides[get_db]())
    m = db.query(Mandate).filter(Mandate.id == mid).first()
    m.status = "active"
    m.vault_id = None
    db.commit()

    mock_semantic = SemanticEvaluationResult(
        category_fits=True,
        detected_category="books",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Books category matches.",
    )

    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_semantic):
        r = test_client.post("/purchases/attempt", json={
            "mandate_token": token,
            "item": "Book",
            "merchant": "BookStore",
            "amount": 20.0,
            "category": "books",
        })

    assert r.status_code == 200
    assert r.json()["decision"] == "blocked"
    assert any("vault" in reason.lower() for reason in r.json()["receipt"]["reasons"])


def test_vault_fallback_enabled_returns_approve_url(test_client):
    """When PAYPAL_VAULT_FALLBACK is true, an unvaulted active approved purchase returns an approve_url."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 100.0, "per_purchase_cap": 50.0,
        "allowed_categories": ["books"],
    })
    mid = create_r.json()["id"]
    token = create_r.json()["token"]

    # Mark mandate active without a vault_id
    from app.models import Mandate
    from app.database import get_db
    db = next(app.dependency_overrides[get_db]())
    m = db.query(Mandate).filter(Mandate.id == mid).first()
    m.status = "active"
    m.vault_id = None
    db.commit()

    mock_semantic = SemanticEvaluationResult(
        category_fits=True,
        detected_category="books",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Books category matches.",
    )

    mock_fallback_order = {
        "id": "ORD-FALLBACK-123",
        "links": [
            {"rel": "payer-action", "href": "https://www.sandbox.paypal.com/checkoutnow?token=ORD-FALLBACK-123"}
        ],
    }

    settings = get_settings()
    with patch.object(settings, "paypal_vault_fallback", True), \
         patch("app.routers.purchases.settings", settings), \
         patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_semantic), \
         patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_fallback_order", new_callable=AsyncMock, return_value=mock_fallback_order):

        r = test_client.post("/purchases/attempt", json={
            "mandate_token": token,
            "item": "Clean Code Book",
            "merchant": "BookStore",
            "amount": 20.0,
            "category": "books",
        })

    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "approved"
    assert "approve_url" in body
    assert "ORD-FALLBACK-123" in body["approve_url"]
    assert body["receipt"]["paypal_order_id"] == "ORD-FALLBACK-123"
    assert body["receipt"]["decision"] == "approved"
