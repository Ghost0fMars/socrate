"""Relais web de Socrate (fonction Vercel).

La version web est une vitrine : documents, index vectoriel et conversations restent
dans le navigateur du visiteur. Ce relais ne stocke rien ; il garde seulement la clé
Albert côté serveur et expose trois routes : modèles, embeddings et chat."""

import pathlib
import sys
import time

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "server"))
import socrate_core  # noqa: E402

MAX_EMBED_INPUTS = 32
MAX_EMBED_CHARS = 6000
MAX_MESSAGE_CHARS = 4000
MAX_HISTORY = 30
MAX_HISTORY_CHARS = 8000
MAX_CONTEXT_CHARS = 24000
MODELS_TTL = 600

app = FastAPI()
_models_cache: tuple[float, list[dict]] = (0.0, [])


def _chat_models() -> list[dict]:
    global _models_cache
    fetched_at, cached = _models_cache
    if cached and time.time() - fetched_at < MODELS_TTL:
        return cached
    models = socrate_core.albert_chat_models()
    _models_cache = (time.time(), models)
    return models


def _require_key() -> None:
    if not socrate_core.ALBERT_API_KEY:
        raise HTTPException(status_code=503, detail="ALBERT_API_KEY n'est pas configurée sur le serveur.")


class EmbeddingsRequest(BaseModel):
    input: list[str] = Field(max_length=MAX_EMBED_INPUTS)


class HistoryMessage(BaseModel):
    role: str
    content: str = Field(max_length=MAX_HISTORY_CHARS)


class ChatRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE_CHARS)
    history: list[HistoryMessage] = Field(default_factory=list)
    use_corpus: bool = True
    model: str | None = None
    context: str = ""


@app.get("/api/models")
@app.get("/models")
def list_models():
    _require_key()
    try:
        models = _chat_models()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Albert indisponible : {exc}")
    names = [m["name"] for m in models]
    default = socrate_core.ALBERT_MODEL if socrate_core.ALBERT_MODEL in names else (names[0] if names else "")
    return {"default": default, "models": models}


@app.post("/api/embeddings")
@app.post("/embeddings")
def embeddings(request: EmbeddingsRequest):
    _require_key()
    texts = [text[:MAX_EMBED_CHARS] for text in request.input if text.strip()]
    if not texts:
        return {"embeddings": []}
    try:
        return {"embeddings": socrate_core.albert_embed(texts)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erreur d'embedding Albert : {exc}")


@app.post("/api/chat")
@app.post("/chat")
async def chat(request: ChatRequest):
    _require_key()
    names = [m["name"] for m in _chat_models()]
    model = request.model if request.model in names else socrate_core.ALBERT_MODEL

    history = [
        {"role": m.role, "content": m.content}
        for m in request.history[-MAX_HISTORY:]
        if m.role in ("user", "assistant", "model")
    ]
    messages = socrate_core.build_chat_messages(
        request.message,
        history,
        request.context[:MAX_CONTEXT_CHARS],
        use_corpus=request.use_corpus,
    )

    async def generate():
        try:
            async for content in socrate_core.albert_stream(model, messages):
                yield content
        except Exception as exc:
            yield f"\n[ERREUR SERVEUR: {type(exc).__name__}: {exc}]"

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
