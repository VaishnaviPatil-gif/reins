# Reins — Architecture

## Overview

Reins is a trust and control layer that sits **between** an AI agent and PayPal. No purchase reaches PayPal without passing through the Reins policy engine.

```
User  ──creates──▶  Mandate (scoped permission token)
                        │
AI Agent  ──POST /purchases/attempt──▶  Policy Engine
                                              │
                              ┌───────────────┼───────────────┐
                           APPROVE          BLOCK          ESCALATE
                              │                                │
                        PayPal Orders API           Human one-tap UI
                              │
                        Receipt (chained hash)
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Mandates | `routers/mandates.py` | CRUD + JWT token issuance |
| Policy Engine | `services/policy.py` | Deterministic rules → Gemini semantic check |
| Receipts | `services/receipts.py` | Chained SHA-256 audit log |
| PayPal Client | `services/paypal.py` | httpx wrapper for sandbox APIs |
| Gemini Client | `services/gemini.py` | Category fit + injection detection |
| Dispute Mediator | `routers/disputes.py` | AI review → optional refund |
| Merchant Badge | `routers/verify.py` | Public trust verification |
| Demo Agent | `routers/agent.py` | Thin Gemini agent with tools |

## Security Defaults

- **Never APPROVE on error.** Any exception in policy evaluation → ESCALATE.
- **Mandate token is HMAC-signed JWT.** Tampering detected server-side.
- **Receipt hash chain.** SHA-256(prev_hash + receipt fields) — tampering changes all subsequent hashes.
- **Injection detection.** Gemini reviews raw product description for adversarial instructions.

## Data Flow: Purchase Attempt

1. Agent sends `POST /purchases/attempt` with mandate token + item details
2. Backend verifies JWT signature and mandate status
3. Deterministic checks: budget, cap, merchant lists, time window, expiry
4. Gemini checks: category fit, injection detection
5. If APPROVE → PayPal create + capture order → write receipt
6. If ESCALATE → write pending receipt → notify user → wait for one-tap
7. If BLOCK → write blocked receipt → return 403
