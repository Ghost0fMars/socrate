import os
import pathlib

from dotenv import load_dotenv

_env = pathlib.Path(__file__).parent.parent / ".env.local"
if _env.exists():
    load_dotenv(_env, override=False)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

app = FastAPI()


class _StripApiPrefix(BaseHTTPMiddleware):
    """Vercel passes the full path (/api/chat) to the ASGI app; strip the prefix."""
    async def dispatch(self, request: Request, call_next):
        path = request.scope.get("path", "")
        if path.startswith("/api"):
            stripped = path[4:] or "/"
            request.scope["path"] = stripped
            request.scope["raw_path"] = stripped.encode()
        return await call_next(request)


app.add_middleware(_StripApiPrefix)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is not set")

_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

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


@app.post("/chat")
async def chat(request: ChatRequest):
    model = request.model or OPENAI_MODEL
    messages = [{"role": "system", "content": _SYSTEM_PROMPT}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    async def generate():
        async with await _client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        ) as stream:
            async for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield content

    return StreamingResponse(generate(), media_type="text/plain")


@app.get("/models")
async def list_models():
    return {
        "default": OPENAI_MODEL,
        "models": [{"name": OPENAI_MODEL, "size": 0, "modified_at": ""}],
    }
