"""Aries AI — FastAPI streaming backend + custom HTML/CSS/JS frontend."""

from __future__ import annotations

import json
import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from groq import APIConnectionError, APIStatusError, AuthenticationError, Groq, RateLimitError
from pydantic import BaseModel, Field

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

MODEL_NAME = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b").strip() or "qwen/qwen3.8-27b"
DEFAULT_MAX_TOKENS = 768
DEFAULT_TEMPERATURE = 0.6

SYSTEM_PROMPT = (
    "You are Aries AI: intelligent, friendly, witty, and direct. "
    "Explain technical concepts clearly, write clean debuggable Python code, "
    "and format answers neatly in Markdown. Be concise and avoid filler."
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"


class ChatMessageInput(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=16000)
    history: list[ChatMessageInput] = Field(default_factory=list)
    max_tokens: int = Field(default=DEFAULT_MAX_TOKENS, ge=64, le=4096)
    temperature: float = Field(default=DEFAULT_TEMPERATURE, ge=0.0, le=1.5)
    system_prompt: str = Field(default=SYSTEM_PROMPT, max_length=4000)


def _resolve_api_key() -> str:
    """Return a configured Groq API key or an empty string without exposing it."""
    key = (GROQ_API_KEY or os.getenv("GROQ_API_KEY") or "").strip()
    if not key or key == "your_groq_api_key_here":
        return ""
    return key


def build_messages(
    message: str,
    history: list[dict[str, Any]] | list[ChatMessageInput] | None,
    system_prompt: str = SYSTEM_PROMPT,
) -> list[dict[str, str]]:
    """Build a minimal, non-redundant OpenAI-style message list for Groq."""
    clean_system = (system_prompt or SYSTEM_PROMPT).strip() or SYSTEM_PROMPT
    messages: list[dict[str, str]] = [{"role": "system", "content": clean_system}]

    for turn in history or []:
        role = turn.role if isinstance(turn, ChatMessageInput) else turn.get("role")
        content = turn.content if isinstance(turn, ChatMessageInput) else turn.get("content", "")
        if role not in ("user", "assistant"):
            continue
        text = str(content).strip()
        if text:
            messages.append({"role": role, "content": text})

    user_text = (message or "").strip()
    if user_text:
        messages.append({"role": "user", "content": user_text})

    return messages


def _sse_event(payload: dict[str, Any]) -> str:
    """Serialize a JSON payload into a Server-Sent Event frame."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stream_chat_events(req: ChatRequest) -> Generator[str, None, None]:
    """Stream token deltas from Groq as Server-Sent Events."""
    user_text = req.message.strip()
    if not user_text:
        yield _sse_event({"type": "error", "message": "Please enter a message to get started."})
        return

    api_key = _resolve_api_key()
    if not api_key:
        yield _sse_event(
            {
                "type": "error",
                "code": "missing_key",
                "message": (
                    "GROQ_API_KEY is not configured. Add your key to the .env file "
                    "(`GROQ_API_KEY=your_groq_api_key_here`) and restart the server."
                ),
            }
        )
        return

    messages = build_messages(user_text, req.history, req.system_prompt)

    try:
        client = Groq(api_key=api_key)
        stream = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,  # type: ignore[arg-type]
            max_tokens=req.max_tokens,
            temperature=req.temperature,
            stream=True,
        )

        emitted = False
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content or ""
            if delta:
                emitted = True
                yield _sse_event({"type": "delta", "content": delta})

        if not emitted:
            yield _sse_event(
                {
                    "type": "error",
                    "message": "Received an empty response from the model. Please try again.",
                }
            )
            return

        yield _sse_event({"type": "done"})

    except AuthenticationError:
        yield _sse_event(
            {
                "type": "error",
                "message": (
                    "Authentication failed. Your GROQ_API_KEY appears invalid or expired. "
                    "Update .env with a valid key and restart the server."
                ),
            }
        )
    except RateLimitError:
        yield _sse_event(
            {
                "type": "error",
                "message": "Rate limit reached. Please wait a moment and try again.",
            }
        )
    except APIConnectionError:
        yield _sse_event(
            {
                "type": "error",
                "message": "Connection error. Could not reach the Groq API.",
            }
        )
    except APIStatusError as exc:
        detail = ""
        if isinstance(exc.body, dict):
            err_obj = exc.body.get("error")
            if isinstance(err_obj, dict) and isinstance(err_obj.get("message"), str):
                detail = f" ({err_obj['message']})"
        yield _sse_event(
            {
                "type": "error",
                "message": f"Groq API error (HTTP {exc.status_code}){detail}. Please check your model or request settings.",
            }
        )
    except Exception:
        yield _sse_event(
            {
                "type": "error",
                "message": "Unexpected error while generating a response. Please try again.",
            }
        )


app = FastAPI(title="Aries AI", docs_url=None, redoc_url=None)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_index() -> FileResponse:
    """Serve the custom web UI."""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend assets not found.")
    return FileResponse(index_path)


@app.get("/api/health")
def health_check() -> JSONResponse:
    """Report server readiness and default parameters without exposing secrets."""
    return JSONResponse(
        {
            "status": "ready" if _resolve_api_key() else "missing_key",
            "model": MODEL_NAME,
            "defaults": {
                "max_tokens": DEFAULT_MAX_TOKENS,
                "temperature": DEFAULT_TEMPERATURE,
                "system_prompt": SYSTEM_PROMPT,
            },
        }
    )


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest) -> StreamingResponse:
    """Stream Groq completion tokens over Server-Sent Events."""
    return StreamingResponse(
        stream_chat_events(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")
