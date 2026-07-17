"""
Real-Time Voice Assistant — backend server (Railway deployment).

Single responsibility:
  Expose POST /chat: proxy the conversation to the Groq LLM API and
  stream tokens back to the browser as Server-Sent Events (SSE).

The API key lives here (in env vars) so it is never exposed to the browser.
"""

import json
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.1-8b-instant"  # fast + free tier; ideal for voice latency

# The system prompt shapes replies for SPOKEN conversation:
# short, natural, no markdown/lists (they sound terrible when read aloud),
# and a short first sentence so text-to-speech can start almost immediately.
SYSTEM_PROMPT = (
    "You are a friendly real-time VOICE assistant. Your replies are read "
    "aloud by text-to-speech, so:\n"
    "- Keep answers short: 1 to 3 spoken sentences unless asked for detail.\n"
    "- Make your FIRST sentence short (under 12 words) so speech can start fast.\n"
    "- Use plain conversational language. No markdown, no bullet points, "
    "no emojis, no code blocks.\n"
    "- Be warm, natural and engaging, like a helpful friend."
)

# One pooled HTTP client for the whole app: reusing the TLS connection to
# Groq saves ~0.5-1s per request versus reconnecting every turn.
http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global http_client
    # connect=3s: fail FAST if Groq is unreachable, so the browser's
    # fallback engine can take over instead of leaving the user waiting.
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=3.0))
    # Warm up DNS + TLS to Groq at startup so the first user turn is fast too.
    try:
        await http_client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            timeout=5.0,
        )
    except Exception:
        pass  # warmup is best-effort only
    yield
    await http_client.aclose()


app = FastAPI(title="Real-Time Voice Assistant", lifespan=lifespan)

# Allow cross-origin requests so the Vercel frontend can reach this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


# Health check endpoint for Railway
@app.get("/health")
async def health():
    return {"status": "ok"}


def sse(payload: dict) -> str:
    """Format a dict as one Server-Sent Events message."""
    return f"data: {json.dumps(payload)}\n\n"


@app.post("/chat")
async def chat(request: Request):
    """Stream an LLM reply for the given conversation, token by token."""
    body = await request.json()
    # Keep only the last 12 turns so the request stays small and fast.
    messages = body.get("messages", [])[-12:]

    async def token_stream():
        if not GROQ_API_KEY:
            yield sse({"error": "missing_api_key"})
            return

        payload = {
            "model": MODEL,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
            "stream": True,
            "temperature": 0.7,
            "max_tokens": 300,
        }
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}

        try:
            async with http_client.stream(
                "POST", GROQ_URL, headers=headers, json=payload
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    yield sse({"error": f"api_error_{resp.status_code}"})
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[len("data: "):]
                    if data == "[DONE]":
                        break
                    delta = json.loads(data)["choices"][0]["delta"]
                    token = delta.get("content")
                    if token:
                        yield sse({"token": token})
            yield sse({"done": True})
        except Exception:
            # Network down, DNS failure, timeout... the browser decides
            # how to keep the conversation alive.
            yield sse({"error": "connection_failed"})

    return StreamingResponse(
        token_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
