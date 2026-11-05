"""
Reins — FastAPI application entry point.
Keeps main.py thin: wiring only. Business logic lives in routers and services.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, SessionLocal, Base
from app.models import *  # noqa: F401, F403 — ensure all models are registered before create_all
from app.seed import seed
from app.routers import health as health_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables and seed demo data on startup."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    yield  # App runs here


app = FastAPI(
    title="Reins API",
    description="OAuth for your wallet — a trust and control layer for AI agents spending via PayPal.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production; demo needs flexibility
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router.router)


@app.get("/", tags=["meta"])
async def root():
    return {"message": "Reins API is running. See /docs for the full API."}
