"""
PayPal sandbox HTTP client — single place for all PayPal REST calls.

Architecture note — why vaulting?
PayPal Orders API requires buyer approval before capture (ORDER_NOT_APPROVED otherwise).
We solve this correctly using PayPal Vault:
  1. LINK PAYPAL: create an order with payment_source.paypal + vault instructions.
     Buyer approves ONCE via the returned approve link.
     Capture extracts vault_id from payment_source.paypal.attributes.vault.id.
  2. AGENT PURCHASES: create orders with payment_source.paypal.vault_id.
     These complete server-side — no buyer click needed. Bounded by mandate rules.
  3. REVOKE: DELETE /v3/vault/payment-tokens/{vault_id} — 204 means deleted.

Prerequisite: "Reference Transactions" must be enabled on the sandbox app.
See ARCHITECTURE.md for setup steps.
"""
import uuid
import httpx
from app.config import get_settings

settings = get_settings()


async def get_access_token() -> str:
    """
    Fetch a client-credentials bearer token from PayPal.
    Tokens last ~9 hours; re-fetch every call for demo simplicity.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v1/oauth2/token",
            auth=(settings.paypal_client_id, settings.paypal_client_secret),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def create_vault_setup_order(
    access_token: str,
    return_url: str,
    cancel_url: str,
) -> dict:
    """
    Create a $0 order whose sole purpose is to vault the buyer's PayPal wallet.
    Returns the full order object — caller extracts the 'payer-action' HATEOAS link.

    Why $0? The mandate-linking step shouldn't charge the user; it only establishes
    the vaulted payment token so future agent purchases can proceed server-side.
    PayPal requires a purchase_unit with an amount even for vault-only flows — $1.00
    is the minimum that works reliably in sandbox (some sandboxes reject $0.00).
    We'll refund it immediately after capture.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/checkout/orders",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "PayPal-Request-Id": str(uuid.uuid4()),  # idempotency key
            },
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {"currency_code": "USD", "value": "1.00"},
                        "description": "Reins: Link PayPal — $1 authorization (immediately refunded)",
                    }
                ],
                "payment_source": {
                    "paypal": {
                        "experience_context": {
                            "return_url": return_url,
                            "cancel_url": cancel_url,
                            "user_action": "PAY_NOW",
                            "brand_name": "Reins",
                        },
                        "attributes": {
                            "vault": {
                                "store_in_vault": "ON_SUCCESS",
                                "usage_type": "MERCHANT",
                                "customer_type": "CONSUMER",
                                "description": "Reins spending mandate — revoke anytime in dashboard",
                            }
                        },
                    }
                },
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


async def capture_order(access_token: str, order_id: str) -> dict:
    """
    Capture an approved order. Use Prefer: return=representation so the
    vault.id comes back in the response body without a second GET call.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/checkout/orders/{order_id}/capture",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={},
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


def extract_vault_id(capture_response: dict) -> str | None:
    """
    Pull vault_id from a capture response.
    Path: payment_source.paypal.attributes.vault.id
    Returns None if vaulting wasn't successful or status is not VAULTED.
    """
    try:
        vault = capture_response["payment_source"]["paypal"]["attributes"]["vault"]
        if vault.get("status") == "VAULTED":
            return vault.get("id")
        return None
    except (KeyError, TypeError):
        return None


def extract_capture_id(capture_response: dict) -> str | None:
    """Pull the first capture ID from a completed order."""
    try:
        return capture_response["purchase_units"][0]["payments"]["captures"][0]["id"]
    except (KeyError, TypeError, IndexError):
        return None


async def create_vaulted_order(
    access_token: str,
    vault_id: str,
    amount: float,
    currency: str = "USD",
    description: str = "",
) -> dict:
    """
    Create and immediately capture an order using a stored vault_id.
    No buyer approval needed — this is the agentic commerce path.
    PayPal returns COMPLETED directly when vault_id is valid.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/checkout/orders",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "PayPal-Request-Id": str(uuid.uuid4()),
            },
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {
                            "currency_code": currency,
                            "value": f"{amount:.2f}",
                        },
                        "description": description[:127],
                    }
                ],
                "payment_source": {
                    "paypal": {
                        "vault_id": vault_id,
                    }
                },
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


async def capture_vaulted_order(access_token: str, order_id: str) -> dict:
    """Capture a vaulted order that's in APPROVED state."""
    return await capture_order(access_token, order_id)


async def refund_capture(
    access_token: str, capture_id: str, amount: float, currency: str = "USD"
) -> dict:
    """Trigger a full or partial refund for a captured payment."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/payments/captures/{capture_id}/refund",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={"amount": {"currency_code": currency, "value": f"{amount:.2f}"}},
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


async def delete_vault_token(access_token: str, vault_id: str) -> bool:
    """
    Delete a vaulted payment token (called when user revokes a mandate).
    PayPal v3 Vault API — 204 means success.
    Returns True if deleted, False if already gone (404).
    """
    async with httpx.AsyncClient() as client:
        response = await client.delete(
            f"{settings.paypal_base_url}/v3/vault/payment-tokens/{vault_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
        if response.status_code == 404:
            return False  # Already gone — treat as success
        response.raise_for_status()
        return True
