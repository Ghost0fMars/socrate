import asyncio
import io
import os
import pathlib
import threading
import uuid
from datetime import datetime, timezone

from qdrant_client import QdrantClient, models
import ollama
import pypdf
from docx import Document as DocxDocument
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ollama import AsyncClient
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel, Field

_ENV_LOCAL = pathlib.Path(__file__).parent.parent / ".env.local"
if _ENV_LOCAL.exists():
    load_dotenv(_ENV_LOCAL, override=False)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CHAT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

_openai_client: AsyncOpenAI | None = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
_openai_sync_client: OpenAI | None = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

_OPENAI_PREFIXES = ("gpt-", "o1", "o3", "o4", "text-davinci")
CORPUS_PATH = pathlib.Path(
    os.getenv(
        "SOCRATE_CORPUS_PATH",
        str(pathlib.Path.home() / "Documents" / "SocrateCorpus"),
    )
)
SUPPORTED_DOCUMENT_SUFFIXES = {".pdf", ".docx", ".txt", ".md"}
NON_CHAT_MODEL_MARKERS = (
    "embed",
    "embedding",
    "bge-",
    "e5-",
    "gte-",
    "nomic-embed",
    "snowflake-arctic-embed",
)

# Initialize Qdrant Client in local persistent storage mode
_DB_PATH = pathlib.Path.home() / ".local" / "share" / "socrate" / "qdrant_db"
_DB_PATH.mkdir(parents=True, exist_ok=True)
qdrant_client = QdrantClient(path=str(_DB_PATH))
_qdrant_lock = threading.Lock()

def get_active_collection() -> tuple[str, int]:
    """Return the active collection name and dimension size based on model config."""
    if OPENAI_API_KEY and _openai_sync_client:
        return "documents_openai", 1536
    return "documents", 768

def _ensure_collection(collection_name: str, size: int) -> None:
    try:
        with _qdrant_lock:
            collections = qdrant_client.get_collections().collections
            collection_names = [c.name for c in collections]
            if collection_name not in collection_names:
                qdrant_client.create_collection(
                    collection_name=collection_name,
                    vectors_config=models.VectorParams(
                        size=size,
                        distance=models.Distance.COSINE
                    )
                )
    except Exception as e:
        print(f"Error ensuring Qdrant collection {collection_name!r}: {e}", flush=True)

# Pre-ensure default collections on startup
try:
    _ensure_collection("documents", 768)
    if OPENAI_API_KEY:
        _ensure_collection("documents_openai", 1536)
except Exception as e:
    print(f"Startup Qdrant ensure failed: {e}", flush=True)

# Cache: {doc_id: source_name} — rebuilt on first access, invalidated on write.
_doc_sources_cache: dict[str, str] | None = None

# State of the background corpus indexation.
_index_state: dict = {"running": False, "done": 0, "total": 0, "errors": 0, "result": None}


def _get_doc_sources() -> dict[str, str]:
    global _doc_sources_cache
    if _doc_sources_cache is None:
        seen: dict[str, str] = {}
        offset = None
        collection_name, collection_size = get_active_collection()
        _ensure_collection(collection_name, collection_size)
        while True:
            try:
                with _qdrant_lock:
                    records, offset = qdrant_client.scroll(
                        collection_name=collection_name,
                        limit=1000,
                        offset=offset,
                        with_payload=True,
                        with_vectors=False,
                    )
                for record in records:
                    meta = record.payload or {}
                    did = meta.get("doc_id", "")
                    if did and did not in seen:
                        seen[did] = meta.get("source", "")
            except Exception:
                break
            if offset is None:
                break
        _doc_sources_cache = seen
    return _doc_sources_cache


def _invalidate_cache() -> None:
    global _doc_sources_cache
    _doc_sources_cache = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    use_corpus: bool = True
    model: str | None = None
    doc_id: str | None = None


def chunk_text(text: str, chunk_size: int = 360, overlap: int = 60) -> list[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return [c for c in chunks if c.strip()]


def extract_text(filename: str, content: bytes) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        reader = pypdf.PdfReader(io.BytesIO(content))
        pages = []
        for page_number, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages.append(f"Page {page_number}\n{page_text}")
        return "\n\n".join(pages)
    if lower.endswith((".txt", ".md")):
        return content.decode("utf-8", errors="replace")
    if lower.endswith(".docx"):
        document = DocxDocument(io.BytesIO(content))
        paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)
    raise HTTPException(
        status_code=400, detail="Format non supporte - PDF, DOCX, TXT ou MD uniquement."
    )


def get_corpus_category(path: pathlib.Path) -> str:
    try:
        relative = path.relative_to(CORPUS_PATH)
    except ValueError:
        return ""
    return relative.parts[0] if len(relative.parts) > 1 else ""


def delete_existing_path(path: pathlib.Path) -> None:
    collection_name, _ = get_active_collection()
    try:
        with _qdrant_lock:
            qdrant_client.delete(
                collection_name=collection_name,
                points_selector=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="path",
                            match=models.MatchValue(value=str(path))
                        )
                    ]
                )
            )
    except Exception:
        pass


def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    # Try OpenAI if configured
    if OPENAI_API_KEY and _openai_sync_client:
        try:
            response = _openai_sync_client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )
            return [d.embedding for d in response.data]
        except Exception as e:
            print(f"OpenAI embedding error: {e}, falling back to Ollama", flush=True)

    # Fallback to Ollama
    try:
        response = ollama.embed(model=EMBED_MODEL, input=texts)
        return response.embeddings
    except Exception as e:
        print(f"Ollama embedding error: {e}", flush=True)
        raise

def get_embedding(text: str) -> list[float]:
    embeddings = get_embeddings_batch([text])
    return embeddings[0]

def index_text(
    *,
    filename: str,
    text: str,
    path: pathlib.Path | None = None,
    category: str = "",
) -> dict:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Document vide ou illisible.")

    chunks = chunk_text(text)
    doc_id = str(uuid.uuid4())
    indexed_at = datetime.now(timezone.utc).isoformat()
    word_count = len(text.split())
    source_path = str(path) if path else ""

    collection_name, collection_size = get_active_collection()
    _ensure_collection(collection_name, collection_size)

    if path:
        delete_existing_path(path)

    # Batch embeddings creation in groups of 32 chunks to avoid limits
    batch_size = 32
    embeddings = []
    for offset in range(0, len(chunks), batch_size):
        batch_chunks = chunks[offset:offset + batch_size]
        embeddings.extend(get_embeddings_batch(batch_chunks))

    points = []
    for i, chunk in enumerate(chunks):
        chunk_id = str(uuid.uuid4())
        payload = {
            "source": filename,
            "doc_id": doc_id,
            "chunk": i + 1,
            "chunks": len(chunks),
            "indexed_at": indexed_at,
            "word_count": word_count,
            "path": source_path,
            "category": category,
            "document_content": chunk,
        }
        points.append(
            models.PointStruct(
                id=chunk_id,
                vector=embeddings[i],
                payload=payload
            )
        )

    with _qdrant_lock:
        qdrant_client.upsert(
            collection_name=collection_name,
            points=points,
            wait=True
        )
    _invalidate_cache()

    return {
        "id": doc_id,
        "name": filename,
        "chunks": len(chunks),
        "word_count": word_count,
        "indexed_at": indexed_at,
        "path": source_path,
        "category": category,
    }


_STOP_FR = {
    "avec", "dans", "pour", "sur", "sous", "vers", "dont", "mais",
    "quoi", "quel", "quels", "quelles", "cette", "cela", "leur",
    "nous", "vous", "elles", "sont", "être", "avoir",
}


def _query_words(text: str) -> set[str]:
    return {
        w.strip("?.!,;:'\"()").lower()
        for w in text.split()
        if len(w) > 3
    } - _STOP_FR


def _find_boosted_doc_ids(query: str) -> dict[str, str]:
    """Return {doc_id: source_name} for documents whose filename contains a query word."""
    qwords = _query_words(query)
    if not qwords:
        return {}
    boosted: dict[str, str] = {}
    for doc_id, source in _get_doc_sources().items():
        source_words = {
            w.lower()
            for w in source.replace("-", " ").replace(".", " ").replace("'", " ").split()
            if len(w) > 3
        } - _STOP_FR
        if qwords & source_words:
            boosted[doc_id] = source
    return boosted


def _format_chunk(doc: str, meta: dict) -> str:
    source = meta.get("source", "Document")
    category = meta.get("category", "")
    chunk = meta.get("chunk", 0)
    label = f"{category}/{source}" if category else source
    return f"[source: {label} | extrait: {chunk}]\n{doc}"


def retrieve_context(query: str, n_results: int = 4, doc_id: str | None = None) -> str:
    collection_name, collection_size = get_active_collection()
    _ensure_collection(collection_name, collection_size)
    try:
        with _qdrant_lock:
            count = qdrant_client.get_collection(collection_name=collection_name).points_count
        if count == 0:
            return ""
    except Exception:
        return ""

    try:
        query_embedding = get_embedding(query)
    except Exception as exc:
        print(f"Error getting query embedding in retrieve_context: {exc}", flush=True)
        return ""

    query_filter = None
    if doc_id:
        query_filter = models.Filter(
            must=[
                models.FieldCondition(
                    key="doc_id",
                    match=models.MatchValue(value=doc_id)
                )
            ]
        )

    try:
        with _qdrant_lock:
            results = qdrant_client.query_points(
                collection_name=collection_name,
                query=query_embedding,
                limit=n_results,
                query_filter=query_filter,
                with_payload=True,
                with_vectors=False,
            ).points
    except Exception as exc:
        print(f"Error querying Qdrant in retrieve_context: {exc}", flush=True)
        return ""

    seen: set[str] = set()
    parts: list[str] = []

    def collect(hits, max_dist: float = 0.6):
        for hit in hits:
            meta = hit.payload or {}
            doc = meta.get("document_content", "")
            dist = 1.0 - hit.score  # Cosine distance
            key = f"{meta.get('doc_id')}_{meta.get('chunk')}"
            if key in seen or dist > max_dist:
                continue
            seen.add(key)
            parts.append(_format_chunk(doc, meta))

    collect(results)

    if not doc_id:
        # Keyword boost: when the query names a specific source, prepend its best chunks.
        try:
            boosted = _find_boosted_doc_ids(query)
            for doc_id_boost in boosted:
                with _qdrant_lock:
                    r = qdrant_client.query_points(
                        collection_name=collection_name,
                        query=query_embedding,
                        limit=3,
                        query_filter=models.Filter(
                            must=[
                                models.FieldCondition(
                                    key="doc_id",
                                    match=models.MatchValue(value=doc_id_boost)
                                )
                            ]
                        ),
                        with_payload=True,
                        with_vectors=False,
                    ).points
                # Insert boosted chunks at the front, skipping distance filter
                boosted_parts = []
                for hit in r:
                    meta = hit.payload or {}
                    doc = meta.get("document_content", "")
                    key = f"{meta.get('doc_id')}_{meta.get('chunk')}"
                    if key in seen:
                        continue
                    seen.add(key)
                    boosted_parts.append(_format_chunk(doc, meta))
                parts[:0] = boosted_parts  # prepend
        except Exception as exc:
            print(f"Error in keyword boost retrieve_context: {exc}", flush=True)

    return "\n\n---\n\n".join(parts)



# Keywords identifying the user's own writing — used for style reference.
_STYLE_KEYWORDS = ("journal", "désir", "kubrick", "eyes wide", "mist", "darabont")


def _is_style_source(source: str) -> bool:
    s = source.lower()
    return any(kw in s for kw in _STYLE_KEYWORDS)


def retrieve_style_context(query: str, n_results: int = 3) -> str:
    """Return semantically close excerpts from the user's own writing for style calibration."""
    collection_name, collection_size = get_active_collection()
    _ensure_collection(collection_name, collection_size)
    try:
        with _qdrant_lock:
            count = qdrant_client.get_collection(collection_name=collection_name).points_count
        if count == 0:
            return ""
    except Exception:
        return ""

    try:
        style_doc_ids = {
            doc_id
            for doc_id, source in _get_doc_sources().items()
            if _is_style_source(source)
        }
    except Exception as exc:
        print(f"Error listing style sources in retrieve_style_context: {exc}", flush=True)
        return ""

    if not style_doc_ids:
        return ""

    try:
        query_embedding = get_embedding(query)
    except Exception as exc:
        print(f"Error getting query embedding in retrieve_style_context: {exc}", flush=True)
        return ""

    try:
        with _qdrant_lock:
            results = qdrant_client.query_points(
                collection_name=collection_name,
                query=query_embedding,
                limit=n_results,
                query_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="doc_id",
                            match=models.MatchAny(any=list(style_doc_ids))
                        )
                    ]
                ),
                with_payload=True,
                with_vectors=False,
            ).points
    except Exception as exc:
        print(f"Error querying Qdrant in retrieve_style_context: {exc}", flush=True)
        return ""

    seen: set[str] = set()
    parts: list[str] = []

    for hit in results:
        meta = hit.payload or {}
        doc = meta.get("document_content", "")
        key = f"{meta.get('doc_id')}_{meta.get('chunk')}"
        if key in seen:
            continue
        seen.add(key)
        parts.append(f"[{meta.get('source', 'Document')}]\n{doc}")

    return "\n\n---\n\n".join(parts)


def is_chat_model(name: str) -> bool:
    normalized = name.lower()
    return not any(marker in normalized for marker in NON_CHAT_MODEL_MARKERS)


@app.post("/chat")
async def chat(request: ChatRequest):
    if request.use_corpus:
        context, style_context = await asyncio.gather(
            asyncio.to_thread(retrieve_context, request.message, doc_id=request.doc_id),
            asyncio.to_thread(retrieve_style_context, request.message),
        )
    else:
        context, style_context = "", ""
    model = request.model or CHAT_MODEL

    system_prompt = (
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
        "Réponds en français. Sois précis, exigeant, et intellectuellement stimulant."
    )

    if style_context:
        system_prompt += (
            "\n\nExtraits de l'écriture de cet étudiant — "
            "calibre ta voix sur la sienne :\n\n"
            + style_context
        )

    if context:
        system_prompt += (
            "\n\nCorpus de recherche. Utilise ces extraits seulement s'ils sont pertinents. "
            "Cite la source entre crochets avec le nom du fichier. "
            "Si le corpus est insuffisant, dis-le et propose une piste sans inventer de référence.\n\n"
            + context
        )
    else:
        system_prompt += (
            "\n\nAucun extrait de corpus pertinent pour cette requête. "
            "Tu peux aider à raisonner et à problématiser, "
            "mais ne te réfère pas à des documents non indexés."
        )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    def _is_openai_model(name: str) -> bool:
        return name.lower().startswith(_OPENAI_PREFIXES)

    async def generate():
        try:
            if _is_openai_model(model) and _openai_client:
                async with await _openai_client.chat.completions.create(
                    model=model,
                    messages=messages,
                    stream=True,
                ) as stream:
                    async for chunk in stream:
                        content = chunk.choices[0].delta.content
                        if content:
                            yield content
            else:
                print(f"[chat] calling ollama model={model!r}", flush=True)
                async for chunk in await AsyncClient().chat(
                    model=model, messages=messages, stream=True
                ):
                    content = chunk.message.content
                    if content:
                        yield content
        except Exception as exc:
            import traceback
            traceback.print_exc()
            yield f"\n[ERREUR SERVEUR: {type(exc).__name__}: {exc}]"

    return StreamingResponse(generate(), media_type="text/plain")


@app.get("/models")
async def list_models():
    result_models = []

    if _openai_client:
        result_models.append({
            "name": OPENAI_MODEL,
            "size": 0,
            "modified_at": "",
        })

    try:
        response = ollama.list()
        ollama_models = response.get("models", [])
        for model in ollama_models:
            name = model.get("name") or model.get("model", "")
            if name and is_chat_model(name):
                result_models.append({
                    "name": name,
                    "size": model.get("size", 0),
                    "modified_at": str(model.get("modified_at", "")),
                })
    except Exception:
        pass

    default = OPENAI_MODEL if _openai_client else CHAT_MODEL
    return {"default": default, "models": result_models}


@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename or "document"
    text = extract_text(filename, content)
    return index_text(filename=filename, text=text)


async def _run_index_corpus() -> None:
    global _index_state
    _index_state = {"running": True, "done": 0, "total": 0, "errors": 0, "result": None}

    if not CORPUS_PATH.exists():
        _index_state["running"] = False
        _index_state["result"] = {
            "path": str(CORPUS_PATH), "files": 0, "indexed": [], "errors": []
        }
        return

    all_files = sorted(
        p for p in CORPUS_PATH.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_DOCUMENT_SUFFIXES
    )

    collection_name, collection_size = get_active_collection()
    _ensure_collection(collection_name, collection_size)

    # Skip paths already indexed and unmodified since last indexation.
    try:
        count = qdrant_client.get_collection(collection_name=collection_name).points_count
    except Exception:
        count = 0

    if count > 0:
        path_to_indexed_at: dict[str, str] = {}
        offset = None
        while True:
            try:
                records, offset = qdrant_client.scroll(
                    collection_name=collection_name,
                    limit=1000,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                for record in records:
                    meta = record.payload or {}
                    p = meta.get("path", "")
                    if p and p not in path_to_indexed_at:
                        path_to_indexed_at[p] = meta.get("indexed_at", "")
            except Exception:
                break
            if offset is None:
                break

        files = []
        for f in all_files:
            path_str = str(f)
            if path_str not in path_to_indexed_at:
                files.append(f)
            else:
                try:
                    indexed_at = datetime.fromisoformat(path_to_indexed_at[path_str])
                    file_mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
                    if file_mtime > indexed_at:
                        files.append(f)
                except (ValueError, OSError):
                    files.append(f)
    else:
        files = all_files

    _index_state["total"] = len(files)
    indexed: list[dict] = []
    errors: list[dict] = []

    for path in files:
        try:
            content = path.read_bytes()
            text = extract_text(path.name, content)
            # Run blocking work in thread so the event loop stays responsive.
            result = await asyncio.to_thread(
                index_text,
                filename=path.name,
                text=text,
                path=path,
                category=get_corpus_category(path),
            )
            indexed.append({"name": result["name"], "chunks": result["chunks"]})
        except Exception as exc:
            errors.append({"path": str(path), "error": str(exc)})
            _index_state["errors"] += 1
        _index_state["done"] += 1

    _index_state["running"] = False
    _index_state["result"] = {
        "path": str(CORPUS_PATH),
        "files": len(all_files),
        "indexed": indexed,
        "errors": errors,
    }


@app.post("/documents/index-corpus")
async def index_corpus(background_tasks: BackgroundTasks):
    if _index_state.get("running"):
        raise HTTPException(status_code=409, detail="Indexation déjà en cours.")
    if not CORPUS_PATH.exists():
        raise HTTPException(
            status_code=404, detail=f"Dossier corpus introuvable: {CORPUS_PATH}"
        )
    background_tasks.add_task(_run_index_corpus)
    return {"status": "started"}


@app.get("/documents/index-corpus/status")
async def index_corpus_status():
    return _index_state


@app.get("/documents")
async def list_documents():
    collection_name, collection_size = get_active_collection()
    _ensure_collection(collection_name, collection_size)
    try:
        count = qdrant_client.get_collection(collection_name=collection_name).points_count
        if count == 0:
            return []
    except Exception:
        return []

    seen: dict[str, dict] = {}
    offset = None
    while True:
        try:
            records, offset = qdrant_client.scroll(
                collection_name=collection_name,
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
    return sorted(seen.values(), key=lambda doc: doc["indexed_at"], reverse=True)


@app.get("/documents/stats")
async def document_stats():
    docs = await list_documents()
    return {
        "documents": len(docs),
        "chunks": sum(int(doc.get("chunks") or 0) for doc in docs),
        "words": sum(int(doc.get("word_count") or 0) for doc in docs),
    }


@app.get("/documents/{doc_id}/content")
async def get_document_content(doc_id: str):
    collection_name, _ = get_active_collection()
    all_records = []
    offset = None
    while True:
        try:
            with _qdrant_lock:
                records, offset = qdrant_client.scroll(
                    collection_name=collection_name,
                    scroll_filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="doc_id",
                                match=models.MatchValue(value=doc_id),
                            )
                        ]
                    ),
                    limit=1000,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
            all_records.extend(records)
        except Exception:
            break
        if offset is None:
            break

    if not all_records:
        raise HTTPException(status_code=404, detail="Document non trouvé.")

    all_records.sort(key=lambda r: (r.payload or {}).get("chunk", 0))
    meta0 = all_records[0].payload or {}
    source = meta0.get("source", "Inconnu")
    word_count = meta0.get("word_count", 0)

    chunks_list = [
        {
            "chunk": (r.payload or {}).get("chunk", 0),
            "content": (r.payload or {}).get("document_content", "")
        } for r in all_records
    ]

    path_str = meta0.get("path", "")
    if path_str:
        p = pathlib.Path(path_str)
        if p.exists():
            try:
                text = extract_text(p.name, p.read_bytes())
                return {
                    "name": source, 
                    "content": text, 
                    "word_count": word_count, 
                    "chunks": len(all_records),
                    "chunks_list": chunks_list
                }
            except Exception:
                pass

    # Reconstruct from overlapping chunks (chunk_size=360, overlap=60 → step=300)
    step = 300
    parts: list[str] = []
    for i, record in enumerate(all_records):
        words = ((record.payload or {}).get("document_content", "")).split()
        parts.extend(words[:step] if i < len(all_records) - 1 else words)

    return {
        "name": source, 
        "content": " ".join(parts), 
        "word_count": word_count, 
        "chunks": len(all_records),
        "chunks_list": chunks_list
    }


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    collection_name, _ = get_active_collection()
    try:
        records, _ = qdrant_client.scroll(
            collection_name=collection_name,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id",
                        match=models.MatchValue(value=doc_id)
                    )
                ]
            ),
            limit=1,
            with_payload=False,
            with_vectors=False,
        )
        if not records:
            raise HTTPException(status_code=404, detail="Document non trouve.")

        qdrant_client.delete(
            collection_name=collection_name,
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id",
                        match=models.MatchValue(value=doc_id)
                    )
                ]
            )
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    _invalidate_cache()
    return {"deleted": doc_id}
