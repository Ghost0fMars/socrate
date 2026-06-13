from __future__ import annotations

import asyncio
import io
import os
import pathlib
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv

_env = pathlib.Path(__file__).parent.parent / ".env.local"
if _env.exists():
    load_dotenv(_env, override=False)

from docx import Document as DocxDocument
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from openai import OpenAI
import pypdf
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient, models as qmodels
from api.metrics.dramatic_integral import calculate_dramatic_tension

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY_VAR = os.getenv("QDRANT_API_KEY", "")

_RAW_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_MODEL_FIXES = {
    "gpt-o4-mini": "o4-mini",
    "gpt-o3-mini": "o3-mini",
    "gpt-o3": "o3",
    "gpt-o1-mini": "o1-mini",
    "gpt-o1": "o1",
}
OPENAI_MODEL = _MODEL_FIXES.get(_RAW_MODEL, _RAW_MODEL)
EMBED_MODEL = "text-embedding-3-small"
VECTOR_SIZE = 1536

_client: OpenAI | None = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


_qdrant = None


def _get_qdrant():
    global _qdrant
    if _qdrant is not None:
        return _qdrant
    if not QDRANT_URL:
        return None
    try:
        client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY_VAR or None)
        cols = client.get_collections().collections
        if "documents" not in [c.name for c in cols]:
            client.create_collection(
                collection_name="documents",
                vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=qmodels.Distance.COSINE),
            )
        _qdrant = client
        return _qdrant
    except Exception:
        return None


def extract_text(filename: str, content: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        reader = pypdf.PdfReader(io.BytesIO(content))
        pages = []
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ""
            if text.strip():
                pages.append(f"Page {i}\n{text}")
        return "\n\n".join(pages)
    if lower.endswith((".txt", ".md")):
        return content.decode("utf-8", errors="replace")
    if lower.endswith(".docx"):
        doc = DocxDocument(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    raise HTTPException(status_code=400, detail="Format non supporté — PDF, DOCX, TXT ou MD uniquement.")


def chunk_text(text: str, chunk_size: int = 360, overlap: int = 60) -> list[str]:
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunks.append(" ".join(words[i: i + chunk_size]))
        i += chunk_size - overlap
    return [c for c in chunks if c.strip()]


async def _get_embeddings(texts: list[str]) -> list[list[float]]:
    if not _client:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY non configuré.")
    resp = await asyncio.to_thread(_client.embeddings.create, model=EMBED_MODEL, input=texts)
    return [d.embedding for d in resp.data]


async def _retrieve_context(query: str, doc_id: str | None = None) -> str:
    qdrant = _get_qdrant()
    if not qdrant:
        return ""
    try:
        count = qdrant.get_collection("documents").points_count
        if count == 0:
            return ""
        [embedding] = await _get_embeddings([query])
        query_filter = None
        if doc_id:
            query_filter = qmodels.Filter(
                must=[qmodels.FieldCondition(key="doc_id", match=qmodels.MatchValue(value=doc_id))]
            )
        results = qdrant.query_points(
            collection_name="documents",
            query=embedding,
            limit=4,
            query_filter=query_filter,
            with_payload=True,
            with_vectors=False,
        ).points
        parts, seen = [], set()
        for hit in results:
            meta = hit.payload or {}
            key = f"{meta.get('doc_id')}_{meta.get('chunk')}"
            if key in seen or (1.0 - hit.score) > 0.6:
                continue
            seen.add(key)
            source = meta.get("source", "Document")
            parts.append(f"[source: {source} | extrait: {meta.get('chunk', 0)}]\n{meta.get('document_content', '')}")
        return "\n\n---\n\n".join(parts)
    except Exception:
        return ""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    use_corpus: bool = True
    model: str | None = None
    doc_id: str | None = None


async def _chat_handler(request: ChatRequest):
    if not _client:
        return JSONResponse(
            {"detail": "OPENAI_API_KEY not configured on this server."},
            status_code=503,
        )
    model = request.model or OPENAI_MODEL
    
    context = await _retrieve_context(request.message, request.doc_id) if request.use_corpus else ""

    # Calculate Pedagogical Dramatic Tension S(t)
    history_list = [{"role": msg.role, "content": msg.content} for msg in request.history]
    tension_metrics = calculate_dramatic_tension(history_list, request.message, context)
    is_maieutic = tension_metrics["maieutic_posture"]
    tension_score = tension_metrics["tension_score"]

    system = (
        "Tu es un directeur de recherche universitaire spécialisé en théorie de l'art, "
        "de l'écriture narrative et de la représentation. "
        "Tu connais intimement les travaux de cet étudiant — tu as lu ses textes, "
        "ses scénarios, son journal. Tu travailles depuis son corpus et depuis sa propre écriture.\n\n"
        f"[PEDAGOGICAL METRICS: Dramatic Tension S(t)={tension_score}, Posture={'Maïeutique Pure' if is_maieutic else 'Accompagnement Direct'}]\n\n"
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
    )

    if is_maieutic:
        system += (
            "POSTURE MAÏEUTIQUE STRICTE (Tension cumulée S(t) faible) :\n"
            "— Tu REFUSES catégoriquement de donner des réponses directes, de faire des résumés ou de valider platement les concepts.\n"
            "— Tu réponds uniquement par des relances maïeutiques, en pointant les contradictions ou en renvoyant l'étudiant à ses propres notes passées.\n"
            "— Provoque le déclic par l'effort cognitif et la problématisation.\n\n"
        )
    else:
        system += (
            "POSTURE D'ACCOMPAGNEMENT DIRECT (Tension critique S(t) atteint) :\n"
            "— L'effort cognitif de l'étudiant est suffisant. Tu peux maintenant être plus explicite, direct et l'aider à conceptualiser.\n"
            "— Valide constructivement ses idées, apporte des pistes directes et accompagne sa synthèse.\n\n"
        )

    system += "Réponds en français. Sois précis, exigeant, et intellectuellement stimulant."

    if request.use_corpus:
        if context.strip():
            system += (
                "\n\nCorpus de recherche. Utilise uniquement ces extraits pour répondre. "
                "Cite obligatoirement la source exacte entre crochets avec le nom du fichier. "
                "Si les extraits fournis ne contiennent pas d'information ou de référence précise pour répondre à la question de l'étudiant, "
                "tu dois IMPÉRATIVEMENT refuser de répondre sur le fond et lui demander poliment de te transmettre le document concerné "
                "ou de l'ajouter à son corpus afin que vous puissiez dialoguer ensemble sur cette base.\n\n"
                + context
            )
        else:
            system += (
                "\n\nIMPORTANT (Corpus manquant/insuffisant) : Tu ne disposes d'AUCUN extrait de corpus pertinent pour cette requête. "
                "Tu as l'interdiction formelle de répondre sur le fond de la question ou d'inventer des faits. "
                "Tu dois obligatoirement et poliment déclarer que tu n'as pas trouvé cette référence dans tes documents, "
                "et demander à l'utilisateur de te transmettre le fichier concerné ou de l'ajouter à son corpus afin de pouvoir engager le dialogue."
            )
    else:
        system += (
            "\n\nIMPORTANT : Le corpus n'est pas actif pour cette requête. "
            "Tu dois impérativement rappeler à l'utilisateur qu'il doit activer son corpus ou te transmettre un document "
            "pour pouvoir engager un dialogue d'analyse de recherche."
        )

    messages = [{"role": "system", "content": system}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    try:
        response = await asyncio.to_thread(
            _client.chat.completions.create, model=model, messages=messages
        )
        return PlainTextResponse(response.choices[0].message.content or "")
    except Exception as e:
        return JSONResponse({"detail": f"[DEBUG] {type(e).__name__}: {e}"}, status_code=500)


@app.post("/chat")
@app.post("/api/chat")
async def chat(request: ChatRequest):
    return await _chat_handler(request)


@app.get("/models")
@app.get("/api/models")
async def list_models():
    if not _client:
        return {"default": "", "models": []}
    return {
        "default": OPENAI_MODEL,
        "models": [{"name": OPENAI_MODEL, "size": 0, "modified_at": ""}],
    }


@app.post("/documents/upload")
@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    qdrant = _get_qdrant()
    if not qdrant:
        raise HTTPException(
            status_code=503,
            detail="Stockage non configuré. Ajoutez QDRANT_URL et QDRANT_API_KEY sur Vercel.",
        )
    content = await file.read()
    filename = file.filename or "document"
    text = extract_text(filename, content)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Document vide ou illisible.")

    chunks = chunk_text(text)
    doc_id = str(uuid.uuid4())
    indexed_at = datetime.now(timezone.utc).isoformat()
    word_count = len(text.split())

    embeddings = await _get_embeddings(chunks)

    points = []
    for i, chunk in enumerate(chunks):
        payload = {
            "source": filename,
            "doc_id": doc_id,
            "chunk": i + 1,
            "chunks": len(chunks),
            "indexed_at": indexed_at,
            "word_count": word_count,
            "document_content": chunk,
            "path": "",
            "category": "",
        }
        if i == 0:
            payload["full_content"] = text
        points.append(
            qmodels.PointStruct(
                id=str(uuid.uuid4()),
                vector=embeddings[i],
                payload=payload,
            )
        )
    qdrant.upsert(collection_name="documents", points=points, wait=True)
    return {
        "id": doc_id,
        "name": filename,
        "chunks": len(chunks),
        "word_count": word_count,
        "indexed_at": indexed_at,
        "path": "",
        "category": "",
    }


@app.get("/documents/stats")
@app.get("/api/documents/stats")
async def document_stats():
    docs = await list_documents()
    return {
        "documents": len(docs),
        "chunks": sum(int(d.get("chunks") or 0) for d in docs),
        "words": sum(int(d.get("word_count") or 0) for d in docs),
    }


@app.get("/documents")
@app.get("/api/documents")
async def list_documents():
    qdrant = _get_qdrant()
    if not qdrant:
        return []
    try:
        if qdrant.get_collection("documents").points_count == 0:
            return []
    except Exception:
        return []

    seen: dict[str, dict] = {}
    offset = None
    while True:
        try:
            records, offset = qdrant.scroll(
                collection_name="documents",
                limit=1000,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            for record in records:
                meta = record.payload or {}
                doc_id = meta.get("doc_id", "")
                if doc_id and doc_id not in seen:
                    seen[doc_id] = {
                        "id": doc_id,
                        "name": meta.get("source", "Inconnu"),
                        "chunks": meta.get("chunks", 0),
                        "word_count": meta.get("word_count", 0),
                        "indexed_at": meta.get("indexed_at", ""),
                        "path": meta.get("path", ""),
                        "category": meta.get("category", ""),
                    }
        except Exception:
            break
        if offset is None:
            break
    return sorted(seen.values(), key=lambda d: d["indexed_at"], reverse=True)


@app.delete("/documents/{doc_id}")
@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    qdrant = _get_qdrant()
    if not qdrant:
        raise HTTPException(status_code=503, detail="Stockage non configuré.")
    try:
        qdrant.delete(
            collection_name="documents",
            points_selector=qmodels.Filter(
                must=[qmodels.FieldCondition(key="doc_id", match=qmodels.MatchValue(value=doc_id))]
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"deleted": doc_id}


@app.get("/documents/{doc_id}/content")
@app.get("/api/documents/{doc_id}/content")
async def get_document_content(doc_id: str):
    qdrant = _get_qdrant()
    if not qdrant:
        raise HTTPException(status_code=503, detail="Stockage non configuré.")
    try:
        records, _ = qdrant.scroll(
            collection_name="documents",
            scroll_filter=qmodels.Filter(
                must=[qmodels.FieldCondition(key="doc_id", match=qmodels.MatchValue(value=doc_id))]
            ),
            limit=1000,
            with_payload=True,
            with_vectors=False,
        )
        if not records:
            raise HTTPException(status_code=404, detail="Document non trouvé.")
        sorted_records = sorted(
            records, key=lambda r: (r.payload or {}).get("chunk", 0)
        )
        meta = sorted_records[0].payload or {}
        
        chunks_list = [
            {
                "chunk": (r.payload or {}).get("chunk", 0),
                "content": (r.payload or {}).get("document_content", "")
            } for r in sorted_records
        ]
        
        full_content = meta.get("full_content")
        if full_content:
            return {
                "id": doc_id,
                "name": meta.get("source", ""),
                "content": full_content,
                "word_count": meta.get("word_count", 0),
                "chunks": len(sorted_records),
                "chunks_list": chunks_list,
            }
            
        content = "\n\n".join(
            (r.payload or {}).get("document_content", "") for r in sorted_records
        )
        return {
            "id": doc_id,
            "name": meta.get("source", ""),
            "content": content,
            "word_count": meta.get("word_count", 0),
            "chunks": len(sorted_records),
            "chunks_list": chunks_list,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
