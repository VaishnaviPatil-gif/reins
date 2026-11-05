"""
Reins Policy Engine — deterministic and semantic guardrails for agent spending.

Every purchase attempt passes through here before PayPal is touched.
Three possible outcomes:
  - APPROVE: All deterministic constraints pass + Gemini confirms category fit & no prompt injection.
  - BLOCK: Mandate violated, budget exceeded, unauthorized merchant, forbidden category, or prompt injection detected.
  - ESCALATE: Passes hard limits but crosses user-configured `escalate_above` threshold OR Gemini check failed.

SECURITY PRINCIPLE:
Never approve on an error or partial check. If Gemini or any external service fails,
the engine falls back to ESCALATE for human review.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field

from app.models import Mandate
from app.services.gemini import evaluate_purchase_semantics, SemanticEvaluationResult


class PolicyDecision(BaseModel):
    decision: str = Field(..., description="'approved', 'blocked', or 'escalated'")
    reasons: list[str] = Field(default_factory=list)
    category_verified: Optional[str] = None
    injection_flag: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


async def evaluate_purchase_policy(
    mandate: Mandate,
    item: str,
    merchant: str,
    amount: float,
    currency: str = "USD",
    claimed_category: str = "",
    evidence: dict[str, Any] = None,
) -> PolicyDecision:
    """
    Evaluate deterministic rules followed by Gemini semantic checks.
    """
    evidence = evidence or {}
    reasons: list[str] = []
    now = datetime.now(timezone.utc)

    # ──────────────────────────────────────────────────────────────────────────
    # 1. DETERMINISTIC HARD CONSTRAINTS (Fail fast)
    # ──────────────────────────────────────────────────────────────────────────

    # Check 1: Mandate status
    if mandate.status == "revoked":
        return PolicyDecision(
            decision="blocked",
            reasons=["Mandate has been revoked by user"],
        )
    if mandate.status == "pending_link":
        return PolicyDecision(
            decision="blocked",
            reasons=["Mandate has not completed PayPal link approval"],
        )

    # Check 2: Time validity
    if mandate.valid_from:
        valid_from = mandate.valid_from if mandate.valid_from.tzinfo else mandate.valid_from.replace(tzinfo=timezone.utc)
        if now < valid_from:
            return PolicyDecision(
                decision="blocked",
                reasons=[f"Purchase attempted before mandate becomes valid ({valid_from.isoformat()})"],
            )

    if mandate.valid_until:
        valid_until = mandate.valid_until if mandate.valid_until.tzinfo else mandate.valid_until.replace(tzinfo=timezone.utc)
        if now > valid_until:
            return PolicyDecision(
                decision="blocked",
                reasons=[f"Mandate expired on {valid_until.isoformat()}"],
            )

    # Check 3: Blocked merchants
    blocked_merchants = [m.lower().strip() for m in (mandate.blocked_merchants or [])]
    if merchant.lower().strip() in blocked_merchants:
        return PolicyDecision(
            decision="blocked",
            reasons=[f"Merchant '{merchant}' is explicitly blocked by mandate"],
        )

    # Check 4: Allowed merchants (if whitelist specified)
    allowed_merchants = [m.lower().strip() for m in (mandate.allowed_merchants or [])]
    if allowed_merchants and merchant.lower().strip() not in allowed_merchants:
        return PolicyDecision(
            decision="blocked",
            reasons=[f"Merchant '{merchant}' is not on the allowed merchants list"],
        )

    # Check 5: Per-purchase cap
    if amount > mandate.per_purchase_cap:
        return PolicyDecision(
            decision="blocked",
            reasons=[f"Purchase amount ${amount:.2f} exceeds per-purchase cap of ${mandate.per_purchase_cap:.2f}"],
        )

    # Check 6: Total budget remaining
    remaining_budget = mandate.budget_total - mandate.budget_spent
    if round(amount, 2) > round(remaining_budget, 2):
        return PolicyDecision(
            decision="blocked",
            reasons=[f"Purchase amount ${amount:.2f} exceeds remaining budget of ${remaining_budget:.2f}"],
        )

    # Check 7: Soft threshold for escalation (ask human if above $X)
    needs_escalation = False
    if mandate.escalate_above is not None and amount > mandate.escalate_above:
        needs_escalation = True
        reasons.append(
            f"Amount ${amount:.2f} exceeds human approval threshold of ${mandate.escalate_above:.2f}"
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 2. GEMINI SEMANTIC CHECKS (Category Fit & Prompt Injection)
    # ──────────────────────────────────────────────────────────────────────────
    product_description = evidence.get("description", "")
    semantic_result: Optional[SemanticEvaluationResult] = await evaluate_purchase_semantics(
        item=item,
        merchant=merchant,
        description=product_description,
        claimed_category=claimed_category,
        allowed_categories=mandate.allowed_categories or [],
    )

    # SECURITY FALLBACK: If Gemini could not evaluate semantics, DO NOT approve blindly
    if semantic_result is None:
        reasons.append("Semantic verification unavailable; escalated to human review for safety")
        return PolicyDecision(
            decision="escalated",
            reasons=reasons,
            details={"fallback": True, "reason": "Gemini semantic check unavailable"},
        )

    # Check 8: Prompt Injection Detection
    if semantic_result.injection_detected or semantic_result.injection_risk_score >= 60:
        return PolicyDecision(
            decision="blocked",
            reasons=[
                f"Adversarial prompt injection detected in product details (Risk Score: {semantic_result.injection_risk_score}/100): {semantic_result.reasoning}"
            ],
            category_verified=semantic_result.detected_category,
            injection_flag=True,
            details=semantic_result.model_dump(),
        )

    # Check 9: Category Fit
    if mandate.allowed_categories and not semantic_result.category_fits:
        return PolicyDecision(
            decision="blocked",
            reasons=[
                f"Item '{item}' categorized as '{semantic_result.detected_category}', not in allowed categories: {mandate.allowed_categories}"
            ],
            category_verified=semantic_result.detected_category,
            injection_flag=False,
            details=semantic_result.model_dump(),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 3. FINAL DECISION COMPILATION
    # ──────────────────────────────────────────────────────────────────────────
    if needs_escalation:
        return PolicyDecision(
            decision="escalated",
            reasons=reasons,
            category_verified=semantic_result.detected_category,
            injection_flag=False,
            details=semantic_result.model_dump(),
        )

    reasons.append("All deterministic limits, category rules, and security checks verified")
    return PolicyDecision(
        decision="approved",
        reasons=reasons,
        category_verified=semantic_result.detected_category,
        injection_flag=False,
        details=semantic_result.model_dump(),
    )
