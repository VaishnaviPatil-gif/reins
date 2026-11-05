"""
SQLAlchemy ORM models.  Every table maps 1-to-1 with the data model in ARCHITECTURE.md.
JSON columns use SQLAlchemy's JSON type (stored as TEXT in SQLite, fine for demo).
"""
import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, JSON, ForeignKey, Boolean, Text
)
from sqlalchemy.orm import relationship
from app.database import Base


def _now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    agents = relationship("Agent", back_populates="user")
    mandates = relationship("Mandate", back_populates="user")


class Agent(Base):
    __tablename__ = "agents"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    api_key = Column(String, unique=True, nullable=False)
    user = relationship("User", back_populates="agents")
    mandates = relationship("Mandate", back_populates="agent")
    receipts = relationship("Receipt", back_populates="agent")


class Mandate(Base):
    __tablename__ = "mandates"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    version = Column(Integer, default=1, nullable=False)
    budget_total = Column(Float, nullable=False)
    budget_spent = Column(Float, default=0.0, nullable=False)
    per_purchase_cap = Column(Float, nullable=False)
    escalate_above = Column(Float, nullable=True)          # Ask human if amount > this
    allowed_categories = Column(JSON, default=list)        # e.g. ["books", "electronics"]
    allowed_merchants = Column(JSON, default=list)         # empty = all allowed
    blocked_merchants = Column(JSON, default=list)
    valid_from = Column(DateTime(timezone=True), nullable=True)
    valid_until = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="active")              # active | revoked
    token = Column(Text, nullable=True)                    # signed JWT
    vault_id = Column(String, nullable=True)               # PayPal vault payment token (enables server-side charges)
    paypal_link_order_id = Column(String, nullable=True)   # Order used for the one-time Link PayPal approval
    created_at = Column(DateTime(timezone=True), default=_now)
    user = relationship("User", back_populates="mandates")
    agent = relationship("Agent", back_populates="mandates")
    receipts = relationship("Receipt", back_populates="mandate")


class Receipt(Base):
    __tablename__ = "receipts"
    id = Column(Integer, primary_key=True)
    mandate_id = Column(Integer, ForeignKey("mandates.id"), nullable=False)
    mandate_version = Column(Integer, nullable=False)
    agent_id = Column(Integer, ForeignKey("agents.id"), nullable=False)
    item = Column(String, nullable=False)
    merchant = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="USD")
    category_claimed = Column(String, nullable=True)
    category_verified = Column(String, nullable=True)
    agent_plan = Column(Text, nullable=True)
    evidence = Column(JSON, default=dict)
    decision = Column(String, nullable=False)              # approved|blocked|escalated|denied
    reasons = Column(JSON, default=list)
    injection_flag = Column(Boolean, default=False)
    paypal_order_id = Column(String, nullable=True)
    paypal_capture_id = Column(String, nullable=True)
    prev_hash = Column(String, nullable=True)
    hash = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    mandate = relationship("Mandate", back_populates="receipts")
    agent = relationship("Agent", back_populates="receipts")
    escalation = relationship("Escalation", back_populates="receipt", uselist=False)
    dispute = relationship("Dispute", back_populates="receipt", uselist=False)


class Escalation(Base):
    __tablename__ = "escalations"
    id = Column(Integer, primary_key=True)
    receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=False)
    status = Column(String, default="pending")             # pending|approved|denied
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    receipt = relationship("Receipt", back_populates="escalation")


class Dispute(Base):
    __tablename__ = "disputes"
    id = Column(Integer, primary_key=True)
    receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=False)
    user_statement = Column(Text, nullable=False)
    verdict = Column(String, nullable=True)                # agent_fault|within_mandate
    reasoning = Column(Text, nullable=True)
    refund_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    receipt = relationship("Receipt", back_populates="dispute")
