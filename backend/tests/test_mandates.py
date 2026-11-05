"""
Phase 2 tests — mandate CRUD, token signing, and vault flow mocking.
PayPal calls are always mocked; we test our logic, not PayPal's sandbox.
"""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.seed import seed
from app.services.mandates import issue_mandate_token, verify_mandate_token

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


# ── Token signing ────────────────────────────────────────────────────────────

def test_mandate_token_roundtrip():
    """Token we issue must decode back to the same claims."""
    token = issue_mandate_token(mandate_id=5, user_id=1, agent_id=2, version=1)
    payload = verify_mandate_token(token)
    assert payload["sub"] == "5"
    assert payload["user_id"] == 1
    assert payload["agent_id"] == 2
    assert payload["version"] == 1
    assert payload["iss"] == "reins"


def test_tampered_token_rejected():
    """Flip one character in the token — verification must raise."""
    from jose import JWTError
    token = issue_mandate_token(mandate_id=1, user_id=1, agent_id=1, version=1)
    bad = token[:-4] + "XXXX"
    with pytest.raises(JWTError):
        verify_mandate_token(bad)


# ── Mandate CRUD ─────────────────────────────────────────────────────────────

def test_create_mandate(test_client):
    """Create a mandate — should return 201 with pending_link status."""
    r = test_client.post("/mandates/", json={
        "agent_id": 1,
        "budget_total": 100.0,
        "per_purchase_cap": 25.0,
        "escalate_above": 20.0,
        "allowed_categories": ["books"],
        "allowed_merchants": [],
        "blocked_merchants": ["scamsite.com"],
    })
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending_link"
    assert body["budget_total"] == 100.0
    assert body["token"] is not None
    assert "books" in body["allowed_categories"]


def test_list_mandates(test_client):
    """Create two mandates, list must return both."""
    for _ in range(2):
        test_client.post("/mandates/", json={
            "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
        })
    r = test_client.get("/mandates/")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_mandate_not_found(test_client):
    r = test_client.get("/mandates/9999")
    assert r.status_code == 404


def test_revoke_mandate(test_client):
    """Revoke a mandate — status should become 'revoked'."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.delete_vault_token", new_callable=AsyncMock, return_value=True):
        r = test_client.delete(f"/mandates/{mid}/revoke")

    assert r.status_code == 200
    assert r.json()["mandate_id"] == mid

    get_r = test_client.get(f"/mandates/{mid}")
    assert get_r.json()["status"] == "revoked"


def test_link_paypal_start(test_client):
    """Link-PayPal start should call PayPal and return an approve_url."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    mock_order = {
        "id": "ORDER-123",
        "links": [{"rel": "payer-action", "href": "https://paypal.com/approve/ORDER-123"}],
    }
    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.create_vault_setup_order", new_callable=AsyncMock, return_value=mock_order):
        r = test_client.post(f"/mandates/{mid}/link-paypal")

    assert r.status_code == 200
    body = r.json()
    assert "approve_url" in body
    assert "ORDER-123" in body["approve_url"]


def test_link_paypal_confirm_stores_vault_id(test_client):
    """After buyer approval, vault_id must be stored and status becomes active."""
    create_r = test_client.post("/mandates/", json={
        "agent_id": 1, "budget_total": 50.0, "per_purchase_cap": 10.0,
    })
    mid = create_r.json()["id"]

    mock_capture = {
        "id": "ORDER-123",
        "status": "COMPLETED",
        "payment_source": {
            "paypal": {
                "attributes": {"vault": {"id": "VAULT-ABC-123", "status": "VAULTED"}}
            }
        },
        "purchase_units": [{"payments": {"captures": [{"id": "CAP-XYZ", "status": "COMPLETED"}]}}],
    }
    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.capture_order", new_callable=AsyncMock, return_value=mock_capture), \
         patch("app.routers.mandates.refund_capture", new_callable=AsyncMock, return_value={}):
        r = test_client.get(f"/mandates/{mid}/link-confirm?token=ORDER-123")

    assert r.status_code == 200
    body = r.json()
    assert body["vault_id"] == "VAULT-ABC-123"

    get_r = test_client.get(f"/mandates/{mid}")
    assert get_r.json()["status"] == "active"
    assert get_r.json()["vault_id"] == "VAULT-ABC-123"
