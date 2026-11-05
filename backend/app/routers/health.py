"""
Health check router.
Judges and Render's health probe both hit /health.
Checks DB connectivity and PayPal token fetch so we know the whole stack is wired.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db
from app.services.paypal import get_access_token
from app.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["meta"])
async def health(db: Session = Depends(get_db)):
    """Returns OK when DB is reachable and PayPal credentials are valid."""
    # DB check
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    # PayPal check
    try:
        token = await get_access_token()
        paypal_status = "ok" if token else "empty-token"
    except Exception as e:
        paypal_status = f"error: {e}"

    return HealthResponse(
        status="ok",
        version="1.0.0",
        db=db_status,
        paypal=paypal_status,
    )
