"""
Pydantic v2 schemas for request/response validation.
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
    order_id: str
    approve_url: str
    instructions: str


class MandateLinkConfirm(BaseModel):
    mandate_id: int
    vault_id: str
    setup_charge: str


# ── Purchases & Receipts ─────────────────────────────────────────────────────

class PurchaseAttemptRequest(BaseModel):
    mandate_token: str
    item: str
    merchant: str
    amount: float = Field(..., gt=0)
    currency: str = "USD"
    category: Optional[str] = None
    agent_plan: Optional[str] = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class ReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    mandate_id: int
    mandate_version: int
    agent_id: int
    item: str
    merchant: str
    amount: float
    currency: str
    category_claimed: Optional[str]
    category_verified: Optional[str]
    agent_plan: Optional[str]
    evidence: dict[str, Any]
    decision: str
    reasons: list[str]
    injection_flag: bool
    paypal_order_id: Optional[str]
    paypal_capture_id: Optional[str]
    prev_hash: Optional[str]
    hash: Optional[str]
    created_at: datetime


class PurchaseAttemptResponse(BaseModel):
    decision: str  # approved | blocked | escalated
    receipt: ReceiptOut
    message: str
    escalation_id: Optional[int] = None


class EscalationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    receipt_id: int
    status: str  # pending | approved | denied
    resolved_at: Optional[datetime]
    receipt: Optional[ReceiptOut] = None


class ChainVerificationResponse(BaseModel):
    valid: bool
    total_receipts: int
    broken_at_receipt_id: Optional[int] = None
    reason: str
