"""
Tests for purchase execution, escalation workflow, and cryptographic hash chain verification.
"""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models import Mandate, Receipt, Escalation
from app.seed import seed
from app.services.mandates import issue_mandate_token
from app.services.gemini import SemanticEvaluationResult

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
        client.TestingSessionLocal = TestingSessionLocal
        yield client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def active_mandate(test_client):
    """Creates an active, vaulted mandate in the test database."""
    with test_client.TestingSessionLocal() as db:
        mandate = Mandate(
            user_id=1,
            agent_id=1,
            version=1,
            budget_total=200.0,
            budget_spent=0.0,
            per_purchase_cap=60.0,
            escalate_above=50.0,
            allowed_categories=["books"],
            allowed_merchants=[],
            blocked_merchants=["FraudStore"],
            status="active",
            vault_id="vault_test_token_999",
        )
        db.add(mandate)
        db.commit()
        db.refresh(mandate)
        token = issue_mandate_token(
            mandate_id=mandate.id,
            user_id=1,
            agent_id=1,
            version=1,
        )
        mandate.token = token
        db.commit()
        db.refresh(mandate)
        return mandate


# ── PURCHASE ATTEMPTS ────────────────────────────────────────────────────────

def test_tampered_mandate_token_rejected(test_client):
    r = test_client.post("/purchases/attempt", json={
        "mandate_token": "tampered.jwt.token",
        "item": "Book",
        "merchant": "GoodShop",
        "amount": 20.0,
    })
    assert r.status_code == 401
    assert "Invalid or tampered" in r.json()["detail"]


def test_attempt_purchase_approved_creates_chained_receipt(test_client, active_mandate):
    mock_semantic = SemanticEvaluationResult(
        category_fits=True,
        detected_category="books",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Legitimate book",
    )
    mock_order = {"id": "ORDER-APPROVED-1", "status": "COMPLETED"}

    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_semantic), \
         patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_vaulted_order", new_callable=AsyncMock, return_value=mock_order), \
         patch("app.routers.purchases.extract_capture_id", return_value="CAPTURE-99"):

        r = test_client.post("/purchases/attempt", json={
            "mandate_token": active_mandate.token,
            "item": "Algorithms in Python",
            "merchant": "CodeShop",
            "amount": 35.0,
            "category": "books",
        })

    assert r.status_code == 200
    data = r.json()
    assert data["decision"] == "approved"
    assert data["receipt"]["item"] == "Algorithms in Python"
    assert data["receipt"]["paypal_order_id"] == "ORDER-APPROVED-1"
    assert data["receipt"]["prev_hash"] is not None
    assert data["receipt"]["hash"] is not None


def test_attempt_purchase_blocked_by_policy(test_client, active_mandate):
    """Merchant on blocked list causes immediate block and logs a blocked receipt."""
    r = test_client.post("/purchases/attempt", json={
        "mandate_token": active_mandate.token,
        "item": "Suspicious Item",
        "merchant": "FraudStore",
        "amount": 20.0,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["decision"] == "blocked"
    assert "explicitly blocked" in data["receipt"]["reasons"][0]


def test_attempt_purchase_escalated_and_resolved(test_client, active_mandate):
    """Amount $55 is below cap $60 but above escalate_above $50 -> Escalated."""
    mock_semantic = SemanticEvaluationResult(
        category_fits=True,
        detected_category="books",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Pricy reference manual",
    )
    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_semantic):
        r = test_client.post("/purchases/attempt", json={
            "mandate_token": active_mandate.token,
            "item": "Comprehensive CS Encyclopedia",
            "merchant": "TechBooks",
            "amount": 55.0,
            "category": "books",
        })

    assert r.status_code == 200
    data = r.json()
    assert data["decision"] == "escalated"
    escalation_id = data["escalation_id"]
    assert escalation_id is not None

    # Check escalation list
    list_r = test_client.get("/purchases/escalations")
    assert list_r.status_code == 200
    assert any(esc["id"] == escalation_id for esc in list_r.json())

    # Approve the escalation
    mock_order = {"id": "ORDER-ESC-1", "status": "COMPLETED"}
    with patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_vaulted_order", new_callable=AsyncMock, return_value=mock_order), \
         patch("app.routers.purchases.extract_capture_id", return_value="CAP-ESC-1"):

        approve_r = test_client.post(f"/purchases/escalations/{escalation_id}/approve")

    assert approve_r.status_code == 200
    assert "approved and payment captured" in approve_r.json()["message"]


# ── CRYPTOGRAPHIC HASH CHAIN INTEGRITY ────────────────────────────────────────

def test_hash_chain_tamper_detection(test_client, active_mandate):
    """Creates two chained receipts, verifies valid chain, then tampers with one and verifies failure."""
    mock_semantic = SemanticEvaluationResult(
        category_fits=True,
        detected_category="books",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Legitimate book",
    )
    mock_order = {"id": "ORDER-1", "status": "COMPLETED"}

    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_semantic), \
         patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_vaulted_order", new_callable=AsyncMock, return_value=mock_order), \
         patch("app.routers.purchases.extract_capture_id", return_value="CAP-1"):

        # Create Receipt 1
        test_client.post("/purchases/attempt", json={
            "mandate_token": active_mandate.token,
            "item": "Book 1",
            "merchant": "CodeShop",
            "amount": 10.0,
            "category": "books",
        })
        # Create Receipt 2
        test_client.post("/purchases/attempt", json={
            "mandate_token": active_mandate.token,
            "item": "Book 2",
            "merchant": "CodeShop",
            "amount": 15.0,
            "category": "books",
        })

    # Chain should be valid initially
    verify_r = test_client.get("/purchases/receipts/verify-chain")
    assert verify_r.status_code == 200
    assert verify_r.json()["valid"] is True
    assert verify_r.json()["total_receipts"] == 2

    # Malicious actor tampers directly with the database record for Receipt 1
    with test_client.TestingSessionLocal() as db:
        r1 = db.query(Receipt).filter(Receipt.id == 1).first()
        r1.amount = 999.0  # Fraudulent change
        db.commit()

    # Chain verification MUST fail and detect tampering at receipt #1!
    verify_tampered_r = test_client.get("/purchases/receipts/verify-chain")
    assert verify_tampered_r.status_code == 200
    res = verify_tampered_r.json()
    assert res["valid"] is False
    assert res["broken_at_receipt_id"] == 1
    assert "altered" in res["reason"]
