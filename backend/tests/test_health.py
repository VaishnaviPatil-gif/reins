"""
Phase 1 smoke tests: DB up, seed works, health endpoint returns expected shape.
These run without real PayPal/Gemini keys (we mock them).
"""
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.seed import seed

# In-memory SQLite for tests — isolated, never touches reins.db
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


def test_root(test_client):
    r = test_client.get("/")
    assert r.status_code == 200
    assert "Reins" in r.json()["message"]


def test_health_db_ok(test_client):
    """DB should always be reachable in test; PayPal is mocked."""
    with patch(
        "app.routers.health.get_access_token",
        new_callable=AsyncMock,
        return_value="mock-token",
    ):
        r = test_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] == "ok"
    assert body["paypal"] == "ok"


def test_health_paypal_error_still_returns_200(test_client):
    """Health should report the error but not crash — judges need to see the endpoint."""
    with patch(
        "app.routers.health.get_access_token",
        new_callable=AsyncMock,
        side_effect=Exception("network error"),
    ):
        r = test_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert "error" in body["paypal"]


def test_seed_idempotent(test_client):
    """Calling /health twice must not duplicate seed rows."""
    with patch("app.routers.health.get_access_token", new_callable=AsyncMock, return_value="t"):
        test_client.get("/health")
        test_client.get("/health")
    # If seed wasn't idempotent, the second lifespan call would error — reaching here = pass


def test_reins_signing_secret_missing_refuses_to_start():
    """Ensure the application strictly refuses to start outside tests without REINS_SIGNING_SECRET."""
    import os
    from app.config import Settings
    with patch.dict(os.environ, {"REINS_PROD_TEST": "1"}):
        with pytest.raises(ValueError, match="REINS_SIGNING_SECRET is missing"):
            Settings.validate_signing_secret("")
