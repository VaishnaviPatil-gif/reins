"""
PayPal sandbox HTTP client.
All PayPal calls go through here — single place to swap sandbox → live.
Uses httpx (async-capable, clean API, no bloated SDK).
"""
import httpx
from app.config import get_settings

settings = get_settings()


async def get_access_token() -> str:
    """
    Fetch a client-credentials bearer token from PayPal.
    Tokens last ~9 hours; for the demo we re-fetch each time (simple, correct).
    Production would cache with TTL.
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
        data = response.json()
        return data["access_token"]


async def create_order(access_token: str, amount: float, currency: str = "USD", item_name: str = "") -> dict:
    """
    Create a PayPal order in CAPTURE intent mode.
    Returns the full PayPal order object (we need order_id and status).
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/checkout/orders",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {
                            "currency_code": currency,
                            "value": f"{amount:.2f}",
                        },
                        "description": item_name[:127],  # PayPal max 127 chars
                    }
                ],
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


async def capture_order(access_token: str, order_id: str) -> dict:
    """
    Capture an already-created order.
    In sandbox with client-credentials (no buyer approval), PayPal captures directly.
    """
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/checkout/orders/{order_id}/capture",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={},
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()


async def refund_capture(access_token: str, capture_id: str, amount: float, currency: str = "USD") -> dict:
    """Trigger a full refund for a captured payment."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{settings.paypal_base_url}/v2/payments/captures/{capture_id}/refund",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "amount": {"currency_code": currency, "value": f"{amount:.2f}"}
            },
            timeout=15.0,
        )
        response.raise_for_status()
        return response.json()
