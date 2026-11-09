"""
Reins — FastAPI application entry point.
Keeps main.py thin: wiring only. Business logic lives in routers and services.
"""
import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, SessionLocal, Base
from app.models import *  # noqa: F401, F403 — ensure all models are registered before create_all
from app.seed import seed
from app.routers import health as health_router
from app.routers import mandates as mandates_router
from app.routers import purchases as purchases_router
from app.routers import agent as agent_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables and seed demo data on startup."""
    # Ensure REINS_SIGNING_SECRET is configured outside tests
    is_testing = (
        "pytest" in sys.modules
        or "PYTEST_CURRENT_TEST" in os.environ
        or any("pytest" in arg for arg in sys.argv)
    )
    if not settings.reins_signing_secret and not is_testing:
        raise RuntimeError("REINS_SIGNING_SECRET is missing. The app refuses to start outside tests without REINS_SIGNING_SECRET.")

    if not is_testing:
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            seed(db)
        finally:
            db.close()
    yield  # App runs here


settings = get_settings()

app = FastAPI(
    title="Reins API",
    description="OAuth for your wallet — a trust and control layer for AI agents spending via PayPal.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: allow strictly FRONTEND_BASE_URL (and local dev origins if frontend is running locally)
cors_origins = [settings.frontend_base_url.rstrip("/")]
if any(dev_host in settings.frontend_base_url for dev_host in ["localhost", "127.0.0.1"]):
    cors_origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])
cors_origins = list(dict.fromkeys(cors_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router.router)
app.include_router(mandates_router.router)
app.include_router(purchases_router.router)
app.include_router(agent_router.router)


@app.get("/", tags=["meta"])
async def root():
    return {"message": "Reins API is running. See /docs for the full API."}
