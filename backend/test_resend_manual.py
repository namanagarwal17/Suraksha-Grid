import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

async def main():
    key = os.getenv("RESEND_API_KEY")
    to = os.getenv("RESEND_TEST_TO")

    if not key or not to:
        print("Missing RESEND_API_KEY or RESEND_TEST_TO")
        return

    payload = {
        "from": "Suraksha Grid <onboarding@resend.dev>",
        "to": [to],
        "subject": "Suraksha Grid - Resend test",
        "text": "Manual email configuration test. No emergency was triggered."
    }

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {key}"},
            json=payload
        )

    print("HTTP status:", response.status_code)
    print("Response:", response.text[:500])

asyncio.run(main())
