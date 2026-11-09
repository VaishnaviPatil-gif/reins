"""
Phase 5 tests — Demo agent scenario runner, catalog inspection,
and cryptographic receipt chain tamper simulation & repair.
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
        yield client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def active_mandate(test_client):
    """Creates a seeded active mandate for restocking supplies."""
    r = test_client.post("/mandates/", json={
        "agent_id": 1,
        "budget_total": 300.0,
        "per_purchase_cap": 100.0,
        "escalate_above": 50.0,
        "allowed_categories": ["shipping_supplies", "packaging", "office_supplies"],
        "allowed_merchants": [],
        "blocked_merchants": ["scamseller.com"],
    })
    mid = r.json()["id"]

    # Mock PayPal vault linking to mark mandate active
    mock_order = {"id": "ORDER-VAULT-1", "links": [{"rel": "payer-action", "href": "https://paypal.com/approve/1"}]}
    mock_capture = {
        "id": "ORDER-VAULT-1",
        "status": "COMPLETED",
        "payment_source": {"paypal": {"attributes": {"vault": {"id": "VAULT-TOKEN-999", "status": "VAULTED"}}}},
        "purchase_units": [{"payments": {"captures": [{"id": "CAP-INITIAL-1", "status": "COMPLETED"}]}}],
    }
    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.create_vault_setup_order", new_callable=AsyncMock, return_value=mock_order):
        test_client.post(f"/mandates/{mid}/link-paypal")

    with patch("app.routers.mandates.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.mandates.capture_order", new_callable=AsyncMock, return_value=mock_capture), \
         patch("app.routers.mandates.refund_capture", new_callable=AsyncMock, return_value={}):
        test_client.get(f"/mandates/{mid}/link-confirm?token=ORDER-VAULT-1")

    return mid


# ── Catalog Tests ────────────────────────────────────────────────────────────

def test_get_catalog(test_client):
    r = test_client.get("/agent/catalog")
    assert r.status_code == 200
    catalog = r.json()
    assert len(catalog) >= 4

    # Check for presence of the malicious prompt-injection item
    injected_items = [item for item in catalog if item.get("injection_warning")]
    assert len(injected_items) == 1
    assert "PROMPT INJECTION" in injected_items[0]["injection_warning"]


# ── Agent Scenario Runner Tests ──────────────────────────────────────────────

def test_run_scenario_clean_purchase(test_client, active_mandate):
    """Scenario 1: Clean restock purchase should be approved and charged via vault."""
    mock_order = {"id": "ORD-CLEAN-1", "status": "COMPLETED", "purchase_units": [{"payments": {"captures": [{"id": "CAP-CLEAN-1"}]}}]}
    mock_gemini = SemanticEvaluationResult(
        category_fits=True,
        detected_category="shipping_supplies",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Packaging and shipping supplies category matches.",
    )

    with patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_vaulted_order", new_callable=AsyncMock, return_value=mock_order), \
         patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_gemini):
        r = test_client.post("/agent/run-scenarios", json={
            "mandate_id": active_mandate,
            "scenario_id": "clean",
        })

    assert r.status_code == 200
    results = r.json()
    assert len(results) == 1
    res = results[0]
    assert res["scenario"] == "clean"
    assert res["actual_decision"] == "approved"
    assert res["passed_expected"] is True
    assert res["paypal_capture_id"] == "CAP-CLEAN-1"
    assert res["receipt_id"] is not None


def test_run_scenario_over_cap_blocked(test_client, active_mandate):
    """Scenario 2: Over per_purchase_cap must be blocked by deterministic policy."""
    r = test_client.post("/agent/run-scenarios", json={
        "mandate_id": active_mandate,
        "scenario_id": "over_cap",
    })

    assert r.status_code == 200
    results = r.json()
    assert len(results) == 1
    res = results[0]
    assert res["scenario"] == "over_cap"
    assert res["actual_decision"] == "blocked"
    assert res["passed_expected"] is True
    assert any("cap" in reason.lower() for reason in res["reasons"])


def test_run_scenario_malicious_injection_blocked(test_client, active_mandate):
    """Scenario 3: Hostile listing with prompt injection must be blocked by Gemini."""
    mock_gemini = SemanticEvaluationResult(
        category_fits=True,
        detected_category="packaging",
        injection_detected=True,
        injection_risk_score=95,
        reasoning="Prompt injection detected: contains instructions attempting to override spending limits.",
    )

    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_gemini):
        r = test_client.post("/agent/run-scenarios", json={
            "mandate_id": active_mandate,
            "scenario_id": "malicious",
        })

    assert r.status_code == 200
    results = r.json()
    assert len(results) == 1
    res = results[0]
    assert res["scenario"] == "malicious"
    assert res["actual_decision"] == "blocked"
    assert res["injection_flag"] is True
    assert res["passed_expected"] is True


def test_run_scenario_escalated_above_threshold(test_client, active_mandate):
    """Scenario 4: Purchase above escalate_above must create a pending human escalation."""
    mock_gemini = SemanticEvaluationResult(
        category_fits=True,
        detected_category="packaging",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Packaging category matches.",
    )

    with patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_gemini):
        r = test_client.post("/agent/run-scenarios", json={
            "mandate_id": active_mandate,
            "scenario_id": "escalate",
        })

    assert r.status_code == 200
    results = r.json()
    assert len(results) == 1
    res = results[0]
    assert res["scenario"] == "escalate"
    assert res["actual_decision"] == "escalated"
    assert res["passed_expected"] is True
    assert res["escalation_id"] is not None

    # Verify pending escalation exists in escalations list
    esc_r = test_client.get("/purchases/escalations")
    assert esc_r.status_code == 200
    pending_ids = [e["id"] for e in esc_r.json()]
    assert res["escalation_id"] in pending_ids


# ── Receipt Hash Chain Tamper Simulation & Restore Tests ──────────────────────

def test_receipt_tamper_gated_when_demo_mode_false(test_client, active_mandate):
    """
    Ensure simulate-tamper and restore endpoints return 404 when DEMO_MODE is false.
    """
    from app.config import get_settings
    settings = get_settings()
    settings.demo_mode = False

    r1 = test_client.post("/purchases/receipts/simulate-tamper")
    assert r1.status_code == 404
    assert "disabled" in r1.json()["detail"].lower()

    r2 = test_client.post("/purchases/receipts/repair-chain")
    assert r2.status_code == 404
    assert "disabled" in r2.json()["detail"].lower()

    r3 = test_client.post("/purchases/receipts/restore")
    assert r3.status_code == 404
    assert "disabled" in r3.json()["detail"].lower()


def test_receipt_tamper_simulation_and_restore(test_client, active_mandate):
    """
    Test receipt hash chain integrity in DEMO_MODE:
    1. Create a purchase receipt -> chain is valid.
    2. Simulate tamper -> snapshots original and alters receipt in DB -> chain verification fails.
    3. Restore chain -> restores exact original payload snapshot -> chain verification passes.
    """
    from app.config import get_settings
    settings = get_settings()
    settings.demo_mode = True

    # 1. Clean purchase creates receipt
    mock_order = {"id": "ORD-1", "status": "COMPLETED", "purchase_units": [{"payments": {"captures": [{"id": "CAP-1"}]}}]}
    mock_gemini = SemanticEvaluationResult(
        category_fits=True,
        detected_category="shipping_supplies",
        injection_detected=False,
        injection_risk_score=0,
        reasoning="Packaging and shipping supplies category matches.",
    )
    with patch("app.routers.purchases.get_access_token", new_callable=AsyncMock, return_value="tok"), \
         patch("app.routers.purchases.create_vaulted_order", new_callable=AsyncMock, return_value=mock_order), \
         patch("app.services.policy.evaluate_purchase_semantics", new_callable=AsyncMock, return_value=mock_gemini):
        test_client.post("/agent/run-scenarios", json={
            "mandate_id": active_mandate,
            "scenario_id": "clean",
        })

    # Initial verification: chain should be valid
    verify_r1 = test_client.get("/purchases/receipts/verify-chain")
    assert verify_r1.status_code == 200
    assert verify_r1.json()["valid"] is True

    # 2. Simulate tampering directly in DB
    tamper_r = test_client.post("/purchases/receipts/simulate-tamper")
    assert tamper_r.status_code == 200
    tampered_id = tamper_r.json()["tampered_receipt_id"]
    original_amt = tamper_r.json()["original_amount"]

    # Verify chain: must detect tampering at tampered_id
    verify_r2 = test_client.get("/purchases/receipts/verify-chain")
    assert verify_r2.status_code == 200
    assert verify_r2.json()["valid"] is False
    assert verify_r2.json()["broken_at_receipt_id"] == tampered_id

    # 3. Restore chain from snapshot (does NOT recompute hashes)
    restore_r = test_client.post("/purchases/receipts/restore")
    assert restore_r.status_code == 200
    assert restore_r.json()["receipts_restored"] >= 1

    # Verify chain: should now be completely valid again
    verify_r3 = test_client.get("/purchases/receipts/verify-chain")
    assert verify_r3.status_code == 200
    assert verify_r3.json()["valid"] is True

    # Reset demo_mode
    settings.demo_mode = False
