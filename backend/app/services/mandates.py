"""
Mandate token service — issue and verify HMAC-signed JWTs.

Why sign the token?
Merchants and other parties calling GET /verify/{receipt_id} can confirm that a purchase
was backed by a real, unexpired, unrevoked Reins mandate — not a fabricated claim.
The HMAC signature proves the token came from Reins and hasn't been tampered with.
"""
from datetime import datetime, timezone
from jose import jwt, JWTError
from app.config import get_settings

settings = get_settings()

ALGORITHM = "HS256"


def issue_mandate_token(mandate_id: int, user_id: int, agent_id: int, version: int) -> str:
    """
    Sign and return a JWT encoding the mandate's key identity fields.
    The token itself is not a session token — it's a proof-of-mandate artifact
    that agents present when calling /purchases/attempt.
    """
    payload = {
        "sub": str(mandate_id),
        "user_id": user_id,
        "agent_id": agent_id,
        "version": version,
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "iss": "reins",
    }
    return jwt.encode(payload, settings.reins_signing_secret, algorithm=ALGORITHM)


def verify_mandate_token(token: str) -> dict:
    """
    Verify signature and return payload. Raises JWTError on any tampering or bad format.
    Does NOT check DB status (revoked/expired) — caller must do that.
    """
    return jwt.decode(token, settings.reins_signing_secret, algorithms=[ALGORITHM])
