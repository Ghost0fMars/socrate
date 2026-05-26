from __future__ import annotations

import os
import pathlib

from dotenv import load_dotenv

_env = pathlib.Path(__file__).parent.parent / ".env.local"
if _env.exists():
    load_dotenv(_env, override=False)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Correct common model ID typos (e.g. "gpt-o4-mini" → "o4-mini")
_RAW_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_MODEL_FIXES = {
    "gpt-o4-mini": "o4-mini",
    "gpt-o3-mini": "o3-mini",
    "gpt-o3": "o3",
    "gpt-o1-mini": "o1-mini",
    "gpt-o1": "o1",
}
OPENAI_MODEL = _MODEL_FIXES.get(_RAW_MODEL, _RAW_MODEL)

# _client is None when key is missing; routes return 503 instead of crashing.
_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

_SYSTEM_PROMPT = (
    "Tu es un directeur de recherche universitaire spécialisé en théorie de l'art, "
    "de l'écriture narrative et de la représentation. "
    "Tu connais intimement les travaux de cet étudiant — tu as lu ses textes, "
    "ses scénarios, son journal. Tu travailles depuis son corpus et depuis sa propre écriture.\n\n"
    "Ton approche :\n"
    "— Tu poses des questions qui déstabilisent les certitudes sans les détruire.\n"
    "— Tu exiges que chaque affirmation soit étayée, chaque concept défini avec précision.\n"
    "— Tu identifies les glissements conceptuels, les contradictions, "
    "les raccourcis intellectuels non justifiés.\n"
    "— Tu proposes des pistes depuis le corpus quand c'est pertinent, "
    "avec la référence exacte entre crochets.\n"
    "— Tu reconnais la voix de cet étudiant et tu t'y accordes — "
    "tu adoptes son registre, son rythme, sa façon d'articuler les idées.\n"
    "— Tu ne flattes pas. Tu stimules. Tu exiges.\n\n"
    "Réponds en français. Sois précis, exigeant, et intellectuellement stimulant.\n\n"
    "Aucun corpus local disponible dans cette session. "
    "Tu peux aider à raisonner et à problématiser, "
    "mais ne te réfère pas à des documents non indexés."
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    use_corpus: bool = True
    model: str | None = None


async def _chat_handler(request: ChatRequest):
    if not _client:
        return JSONResponse(
            {"detail": "OPENAI_API_KEY not configured on this server."},
            status_code=503,
        )
    model = request.model or OPENAI_MODEL
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    response = await _client.chat.completions.create(
        model=model,
        messages=messages,
        stream=False,
    )
    content = response.choices[0].message.content or ""
    return PlainTextResponse(content)


def _models_response():
    if not _client:
        return {"default": "", "models": []}
    return {
        "default": OPENAI_MODEL,
        "models": [{"name": OPENAI_MODEL, "size": 0, "modified_at": ""}],
    }


# Vercel may pass the full path (/api/chat) or strip the prefix (/chat).
# Both are handled explicitly to avoid any middleware path-stripping issues.

@app.post("/chat")
@app.post("/api/chat")
async def chat(request: ChatRequest):
    return await _chat_handler(request)


@app.get("/models")
@app.get("/api/models")
async def list_models():
    return _models_response()
