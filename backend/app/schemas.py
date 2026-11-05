"""
Pydantic v2 schemas for request/response validation.
One file for now — split by domain if they grow beyond ~200 lines.
"""
from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


# ── Meta ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    db: str
    paypal: str


# ── Users / Agents ───────────────────────────────────────────────────────────

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    api_key: str
    user_id: int


# ── Mandates ─────────────────────────────────────────────────────────────────

class MandateCreate(BaseModel):
    agent_id: int
    budget_total: float = Field(..., gt=0, description="Total spending budget in USD")
    per_purchase_cap: float = Field(..., gt=0, description="Max per single purchase")
    escalate_above: Optional[float] = Field(None, description="Ask human if amount > this")
    allowed_categories: list[str] = Field(default_factory=list, examples=[["books", "electronics"]])
    allowed_merchants: list[str] = Field(default_factory=list, description="Empty = all allowed")
    blocked_merchants: list[str] = Field(default_factory=list)
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None


class MandateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    agent_id: int
    version: int
    budget_total: float
    budget_spent: float
    per_purchase_cap: float
    escalate_above: Optional[float]
    allowed_categories: list[str]
    allowed_merchants: list[str]
    blocked_merchants: list[str]
    valid_from: Optional[datetime]
    valid_until: Optional[datetime]
    status: str           # pending_link | active | revoked
    token: Optional[str]
    vault_id: Optional[str]
    created_at: datetime


class MandateLinkStart(BaseModel):
    """Returned when starting the Link PayPal flow."""
    order_id: str
    approve_url: str
    instructions: str


class MandateLinkConfirm(BaseModel):
    """Returned after successful vault capture."""
    mandate_id: int
    vault_id: str
    setup_charge: str


# ── Receipts (stub — filled in Phase 4) ──────────────────────────────────────

class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mandate_id: int
    agent_id: int
    item: str
    merchant: str
    amount: float
    currency: str
    decision: str
    injection_flag: bool
    paypal_order_id: Optional[str]
    paypal_capture_id: Optional[str]
    created_at: datetime
