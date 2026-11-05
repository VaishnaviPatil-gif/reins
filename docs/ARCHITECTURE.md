# Reins — Architecture

## Overview

Reins is a trust and control layer that sits **between** an AI agent and PayPal.
No purchase reaches PayPal without passing through the Reins policy engine.

```
User  ──creates──▶  Mandate (scoped permission token)
                        │
                   Link PayPal (one-time vault setup)
                        │
                   vault_id stored on mandate
                        │
AI Agent  ──POST /purchases/attempt──▶  Policy Engine
                                              │
                              ┌───────────────┼───────────────┐
                           APPROVE          BLOCK          ESCALATE
                              │                                │
                  PayPal Orders (vault_id)         Human one-tap UI
                  server-side, no buyer click
                              │
                        Receipt (chained hash)
```

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Mandates | `routers/mandates.py` | CRUD + JWT token issuance + PayPal vault link/revoke |
| Policy Engine | `services/policy.py` | Deterministic rules → Gemini semantic check |
| Receipts | `services/receipts.py` | Chained SHA-256 audit log |
| PayPal Client | `services/paypal.py` | httpx wrapper for sandbox APIs (vault-aware) |
| Gemini Client | `services/gemini.py` | Category fit + injection detection |
| Dispute Mediator | `routers/disputes.py` | AI review → optional refund |
| Merchant Badge | `routers/verify.py` | Public trust verification |
| Demo Agent | `routers/agent.py` | Thin Gemini agent with tools |

---

## PayPal Vault Design (critical — read before touching paypal.py)

### Why vaulting is required

PayPal Orders API requires **buyer approval** before capture. Without it you get:
```
ORDER_NOT_APPROVED: Order must be approved by buyer before capture.
```

Client credentials alone cannot approve an order. The correct architecture for
agentic commerce is PayPal Vault — the user approves once, we store a `vault_id`,
and all subsequent agent purchases go server-side with no buyer click.

### Flow 1 — Link PayPal (one-time per mandate)

```
POST /v2/checkout/orders
  intent: CAPTURE
  purchase_units: [{ amount: { currency_code: USD, value: "1.00" } }]
  payment_source:
    paypal:
      experience_context: { return_url, cancel_url, user_action: PAY_NOW }
      attributes:
        vault:
          store_in_vault: ON_SUCCESS
          usage_type: MERCHANT
          customer_type: CONSUMER

→ returns payer-action link (buyer approval URL)
```

Buyer visits the approval URL in their browser, logs in with sandbox buyer account, approves.

```
POST /v2/checkout/orders/{order_id}/capture
  Header: Prefer: return=representation    ← critical — gets vault.id in response body

→ payment_source.paypal.attributes.vault.id  ← store this as mandate.vault_id
→ purchase_units[0].payments.captures[0].id  ← capture_id for the $1 refund
```

The $1 setup charge is immediately refunded:
```
POST /v2/payments/captures/{capture_id}/refund
  amount: { currency_code: USD, value: "1.00" }
```

### Flow 2 — Agent Purchase (server-side, no buyer click)

```
POST /v2/checkout/orders
  intent: CAPTURE
  purchase_units: [{ amount: { currency_code: USD, value: "49.99" }, description: "..." }]
  payment_source:
    paypal:
      vault_id: "<stored vault_id>"          ← the magic — no buyer needed
  Header: PayPal-Request-Id: <uuid4>         ← idempotency key (required)

→ status: COMPLETED (or APPROVED, then capture)
```

Then immediately capture:
```
POST /v2/checkout/orders/{order_id}/capture
  Header: Prefer: return=representation
```

### Flow 3 — Revoke Mandate

```
DELETE /v3/vault/payment-tokens/{vault_id}
  → 204 No Content = deleted
  → 404 = already gone (treat as success)
```

### Exact PayPal Sandbox Setup — Enable Reference Transactions

Vaulting requires **Reference Transactions** to be enabled on your sandbox app.
Without it, the capture response will not include `vault.id`.

**Step-by-step:**

1. Go to [developer.paypal.com](https://developer.paypal.com) → **Apps & Credentials**
2. Select your sandbox app (e.g., `Reins Demo`)
3. Under **Features**, look for **Vault** or **Advanced Credit and Debit Card Payments**
4. If you see a **Request Capabilities** or **Enable** button for Vault/Reference Transactions, click it
5. For sandbox, this is usually auto-approved instantly
6. Alternatively: in the app settings, check the **Vault** checkbox under **Features** and save

**If vaulting is not available on your sandbox tier:**

The `link-confirm` endpoint will return a 502 with the message:
> "PayPal did not return a vault_id. Ensure 'Reference Transactions' is enabled..."

In that case, use the **fallback flow**: every agent purchase goes through the approve-link
flow (same as Link PayPal). The agent gets an `approve_url` back, the demo narrates the
approval step, and you manually approve. This is less automated but still demonstrates
the full policy engine + receipt chain.

**To enable the fallback:** Set `PAYPAL_VAULT_FALLBACK=true` in `.env` (Phase 4 will add this).

---

## Security Defaults

- **Never APPROVE on error.** Any exception in policy evaluation → ESCALATE.
- **Mandate token is HMAC-signed JWT.** Tampering detected server-side.
- **Receipt hash chain.** SHA-256(prev_hash + receipt fields) — tampering changes all subsequent hashes.
- **Injection detection.** Gemini reviews raw product description for adversarial instructions.
- **Vault revocation is synchronous.** Revoke → PayPal delete happens before the DB update confirms. If PayPal delete fails, the mandate is still revoked locally (belt-and-suspenders).

---

## Data Flow: Purchase Attempt (Phase 4)

1. Agent sends `POST /purchases/attempt` with mandate token + item details + `X-Agent-Key` header
2. Backend verifies JWT signature and mandate status (must be `active`)
3. Checks mandate has a `vault_id` (must have completed Link PayPal)
4. Deterministic policy checks: budget remaining, per-purchase cap, merchant lists, time window, expiry
5. Gemini semantic checks: category fit, injection detection in product description
6. If APPROVE → `create_vaulted_order` + `capture_vaulted_order` → write chained receipt
7. If ESCALATE → write pending receipt → create escalation row → return 202 (agent must poll)
8. If BLOCK → write blocked receipt → return 403

---

## Mandate Status Machine

```
pending_link  →  (Link PayPal complete)  →  active
active        →  (user clicks Revoke)    →  revoked
pending_link  →  (user clicks Revoke)    →  revoked
```

An agent can only spend through an `active` mandate with a non-null `vault_id`.
