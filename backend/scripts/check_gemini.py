import asyncio
import json
import sys
from pathlib import Path
from dotenv import load_dotenv

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load .env from the backend directory
load_dotenv(backend_dir / ".env")

from app.config import get_settings

settings = get_settings()
key = settings.gemini_api_key
model_name = settings.gemini_model

print(f"Model configured: {model_name}")
print(f"Key present: {bool(key and key not in ('GEMINI_KEY', 'ci-placeholder'))}, prefix: {key[:8] if key else 'MISSING'}...")

if not key or key in ("GEMINI_KEY", "ci-placeholder", "your_gemini_api_key_here"):
    print("ERROR: No real GEMINI_API_KEY found in backend/.env")
    exit(1)

from google import genai
from google.genai import types as t


async def check_gemini():
    client = genai.Client(api_key=key)
    resp = await client.aio.models.generate_content(
        model=model_name,
        contents=f'{{"status": "ok", "model": "{model_name}", "sdk": "google-genai"}}',
        config=t.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )
    print("RAW RESPONSE:", resp.text)
    data = json.loads(resp.text)
    print("PARSED OK:", data)
    assert (
        data.get("status") == "ok"
        or data.get("result") == "success"
        or data.get("received", {}).get("status") == "ok"
    )
    print(f"\n[OK] Gemini ({model_name}) is live and responding correctly.")


if __name__ == "__main__":
    asyncio.run(check_gemini())
