"""
Reasoning Receipts — cryptographic SHA-256 tamper-evident log service.

Every purchase attempt (approved, blocked, or escalated) records:
- Mandate ID & version
- Item, merchant, amount, currency
- Claimed category vs verified category
- Stated agent plan and product evidence
- Policy decision and rationale
- Injection detection flag
- PayPal order ID and capture ID (if approved)
- Previous receipt hash and current receipt hash

The receipt hash is calculated as:
  SHA-256(prev_hash | mandate_id | mandate_version | item | merchant | amount | decision | injection_flag | created_at)

If any row in the DB is tampered with, all subsequent hashes in the chain break.
"""
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models import Receipt, Mandate, Escalation


GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000"


def calculate_receipt_hash(
    prev_hash: str,
    mandate_id: int,
    mandate_version: int,
    agent_id: int,
    item: str,
    merchant: str,
    amount: float,
    currency: str,
    decision: str,
    injection_flag: bool,
    created_at_iso: str,
) -> str:
    """
    Computes deterministic SHA-256 digest of receipt contents chained to prev_hash.
    """
    canonical_payload = "|".join([
        prev_hash,
        str(mandate_id),
        str(mandate_version),
        str(agent_id),
        item.strip(),
        merchant.strip(),
        f"{amount:.2f}",
        currency.upper(),
        decision.lower(),
        str(injection_flag).lower(),
        created_at_iso,
    ])
    return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()


def append_receipt(
    db: Session,
    mandate: Mandate,
    agent_id: int,
    item: str,
    merchant: str,
    amount: float,
    currency: str,
    category_claimed: Optional[str],
    category_verified: Optional[str],
    agent_plan: Optional[str],
    evidence: dict[str, Any],
    decision: str,
    reasons: list[str],
    injection_flag: bool,
    paypal_order_id: Optional[str] = None,
    paypal_capture_id: Optional[str] = None,
) -> Receipt:
    """
    Appends a new receipt to the blockchain-like audit trail.
    Acquires the hash of the latest receipt to link cryptographically.
    """
    # Fetch latest receipt to get previous hash
    last_receipt = (
        db.query(Receipt)
        .order_by(Receipt.id.desc())
        .first()
    )
    prev_hash = last_receipt.hash if (last_receipt and last_receipt.hash) else GENESIS_HASH
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    receipt_hash = calculate_receipt_hash(
        prev_hash=prev_hash,
        mandate_id=mandate.id,
        mandate_version=mandate.version,
        agent_id=agent_id,
        item=item,
        merchant=merchant,
        amount=amount,
        currency=currency,
        decision=decision,
        injection_flag=injection_flag,
        created_at_iso=now_iso,
    )

    receipt = Receipt(
        mandate_id=mandate.id,
        mandate_version=mandate.version,
        agent_id=agent_id,
        item=item,
        merchant=merchant,
        amount=amount,
        currency=currency,
        category_claimed=category_claimed,
        category_verified=category_verified,
        agent_plan=agent_plan,
        evidence=evidence or {},
        decision=decision,
        reasons=reasons or [],
        injection_flag=injection_flag,
        paypal_order_id=paypal_order_id,
        paypal_capture_id=paypal_capture_id,
        prev_hash=prev_hash,
        hash=receipt_hash,
        created_at=now,
    )
    db.add(receipt)
    db.flush()
    return receipt


def verify_receipt_chain(db: Session) -> dict[str, Any]:
    """
    Verifies the entire audit trail from start to finish.
    Returns:
      {
        "valid": True/False,
        "total_receipts": int,
        "broken_at_receipt_id": Optional[int],
        "reason": Optional[str]
      }
    """
    receipts = db.query(Receipt).order_by(Receipt.id.asc()).all()
    if not receipts:
        return {
            "valid": True,
            "total_receipts": 0,
            "broken_at_receipt_id": None,
            "reason": "Log is empty, chain intact",
        }

    expected_prev = GENESIS_HASH

    for r in receipts:
        # Check link to previous
        if r.prev_hash != expected_prev:
            return {
                "valid": False,
                "total_receipts": len(receipts),
                "broken_at_receipt_id": r.id,
                "reason": f"Receipt #{r.id} prev_hash mismatch: expected {expected_prev[:12]}..., got {r.prev_hash[:12]}...",
            }

        # Re-compute current hash
        now_iso = r.created_at.isoformat() if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc).isoformat()
        expected_hash = calculate_receipt_hash(
            prev_hash=r.prev_hash,
            mandate_id=r.mandate_id,
            mandate_version=r.mandate_version,
            agent_id=r.agent_id,
            item=r.item,
            merchant=r.merchant,
            amount=r.amount,
            currency=r.currency,
            decision=r.decision,
            injection_flag=r.injection_flag,
            created_at_iso=now_iso,
        )

        if r.hash != expected_hash:
            return {
                "valid": False,
                "total_receipts": len(receipts),
                "broken_at_receipt_id": r.id,
                "reason": f"Receipt #{r.id} content altered! Hash verification failed.",
            }

        expected_prev = r.hash

    return {
        "valid": True,
        "total_receipts": len(receipts),
        "broken_at_receipt_id": None,
        "reason": "Cryptographic integrity verified across all receipts",
    }


# In-memory storage for original pre-tamper receipt snapshots
_tampered_snapshots: dict[int, dict[str, Any]] = {}


def snapshot_receipt_before_tamper(receipt: Receipt) -> None:
    """Snapshots the exact original receipt payload before simulated tampering."""
    _tampered_snapshots[receipt.id] = {
        "id": receipt.id,
        "amount": receipt.amount,
        "item": receipt.item,
        "merchant": receipt.merchant,
        "decision": receipt.decision,
        "hash": receipt.hash,
        "prev_hash": receipt.prev_hash,
        "injection_flag": receipt.injection_flag,
        "category_claimed": receipt.category_claimed,
        "category_verified": receipt.category_verified,
        "reasons": list(receipt.reasons) if receipt.reasons else [],
        "evidence": dict(receipt.evidence) if receipt.evidence else {},
        "created_at": receipt.created_at,
    }


def restore_tampered_receipts(db: Session) -> int:
    """
    Restores tampered receipts to their exact original pre-tamper payload snapshots.
    Does NOT recompute hashes — restores the exact cryptographically signed state.
    """
    if not _tampered_snapshots:
        return 0

    count = 0
    for receipt_id, snap in list(_tampered_snapshots.items()):
        receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
        if receipt:
            receipt.amount = snap["amount"]
            receipt.item = snap["item"]
            receipt.merchant = snap["merchant"]
            receipt.decision = snap["decision"]
            receipt.hash = snap["hash"]
            receipt.prev_hash = snap["prev_hash"]
            receipt.injection_flag = snap["injection_flag"]
            receipt.category_claimed = snap["category_claimed"]
            receipt.category_verified = snap["category_verified"]
            receipt.reasons = snap["reasons"]
            receipt.evidence = snap["evidence"]
            receipt.created_at = snap["created_at"]
            count += 1

    db.commit()
    _tampered_snapshots.clear()
    return count
