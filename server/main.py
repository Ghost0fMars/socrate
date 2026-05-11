import io
import os
import pathlib
import uuid
from datetime import datetime, timezone

import chromadb
import ollama
import pypdf
from docx import Document as DocxDocument
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ollama import AsyncClient
from pydantic import BaseModel, Field

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CHAT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
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

_DB_PATH = pathlib.Path.home() / ".local" / "share" / "socrate" / "chroma_db"
_DB_PATH.mkdir(parents=True, exist_ok=True)
chroma_client = chromadb.PersistentClient(path=str(_DB_PATH))
collection = chroma_client.get_or_create_collection(
    name="documents",
    metadata={"hnsw:space": "cosine"},
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    use_corpus: bool = True
    model: str | None = None


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
    results = collection.get(where={"path": str(path)})
    if results["ids"]:
        collection.delete(ids=results["ids"])


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

    if path:
        delete_existing_path(path)

    ids, embeddings, documents, metadatas = [], [], [], []
    for i, chunk in enumerate(chunks):
        ids.append(f"{doc_id}_{i}")
        embeddings.append(get_embedding(chunk))
        documents.append(chunk)
        metadatas.append(
            {
                "source": filename,
                "doc_id": doc_id,
                "chunk": i + 1,
                "chunks": len(chunks),
                "indexed_at": indexed_at,
                "word_count": word_count,
                "path": source_path,
                "category": category,
            }
        )

    collection.add(
        embeddings=embeddings, ids=ids, documents=documents, metadatas=metadatas
    )

    return {
        "id": doc_id,
        "name": filename,
        "chunks": len(chunks),
        "word_count": word_count,
        "indexed_at": indexed_at,
        "path": source_path,
        "category": category,
    }


def get_embedding(text: str) -> list[float]:
    response = ollama.embeddings(model=EMBED_MODEL, prompt=text)
    return list(response["embedding"])


def retrieve_context(query: str, n_results: int = 6) -> str:
    if collection.count() == 0:
        return ""
    query_embedding = get_embedding(query)
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, collection.count()),
        include=["documents", "metadatas"],
    )
    if not results["documents"] or not results["documents"][0]:
        return ""
    parts = []
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        source = meta.get("source", "Document")
        category = meta.get("category", "")
        chunk = meta.get("chunk", 0)
        label = f"{category}/{source}" if category else source
        parts.append(f"[source: {label} | extrait: {chunk}]\n{doc}")
    return "\n\n---\n\n".join(parts)


def is_chat_model(name: str) -> bool:
    normalized = name.lower()
    return not any(marker in normalized for marker in NON_CHAT_MODEL_MARKERS)


@app.post("/chat")
async def chat(request: ChatRequest):
    context = retrieve_context(request.message) if request.use_corpus else ""
    model = request.model or CHAT_MODEL

    system_prompt = (
        "Tu es Socrate, un compagnon d'ecriture et de recherche local. "
        "Tu aides l'utilisateur a penser, structurer, problematiser, reformuler "
        "et developper ses travaux. Reponds en francais avec precision, sobriete "
        "et une vraie attention au geste d'ecriture."
    )
    if context:
        system_prompt += (
            "\n\nCorpus de recherche indexe. Utilise ces extraits seulement s'ils sont "
            "pertinents. Quand une idee vient du corpus, cite la source entre crochets "
            "avec le nom du fichier. Si le corpus ne suffit pas, dis-le clairement et "
            "propose une piste de travail sans inventer de reference.\n\n"
            + context
        )
    else:
        system_prompt += (
            "\n\nAucun extrait de corpus pertinent n'est disponible pour cette requete. "
            "Tu peux aider a raisonner et a ecrire, mais ne pretend pas t'appuyer sur "
            "des documents indexes."
        )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    async def generate():
        async for chunk in await AsyncClient().chat(
            model=model, messages=messages, stream=True
        ):
            content = chunk.message.content
            if content:
                yield content

    return StreamingResponse(generate(), media_type="text/plain")


@app.get("/models")
async def list_models():
    response = ollama.list()
    models = response.get("models", [])
    return {
        "default": CHAT_MODEL,
        "models": [
            {
                "name": model.get("name") or model.get("model", ""),
                "size": model.get("size", 0),
                "modified_at": str(model.get("modified_at", "")),
            }
            for model in models
            if (model.get("name") or model.get("model"))
            and is_chat_model(model.get("name") or model.get("model", ""))
        ],
    }


@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename or "document"
    text = extract_text(filename, content)
    return index_text(filename=filename, text=text)


@app.post("/documents/index-corpus")
async def index_corpus():
    if not CORPUS_PATH.exists():
        raise HTTPException(
            status_code=404, detail=f"Dossier corpus introuvable: {CORPUS_PATH}"
        )

    files = sorted(
        path
        for path in CORPUS_PATH.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_DOCUMENT_SUFFIXES
    )

    indexed = []
    errors = []
    for path in files:
        try:
            content = path.read_bytes()
            text = extract_text(path.name, content)
            indexed.append(
                index_text(
                    filename=path.name,
                    text=text,
                    path=path,
                    category=get_corpus_category(path),
                )
            )
        except Exception as exc:
            errors.append({"path": str(path), "error": str(exc)})

    return {
        "path": str(CORPUS_PATH),
        "files": len(files),
        "indexed": indexed,
        "errors": errors,
    }


@app.get("/documents")
async def list_documents():
    if collection.count() == 0:
        return []
    results = collection.get(include=["metadatas"])
    seen: dict[str, dict] = {}
    for meta in results["metadatas"]:
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
    return sorted(seen.values(), key=lambda doc: doc["indexed_at"], reverse=True)


@app.get("/documents/stats")
async def document_stats():
    docs = await list_documents()
    return {
        "documents": len(docs),
        "chunks": sum(int(doc.get("chunks") or 0) for doc in docs),
        "words": sum(int(doc.get("word_count") or 0) for doc in docs),
    }


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    results = collection.get(where={"doc_id": doc_id})
    if not results["ids"]:
        raise HTTPException(status_code=404, detail="Document non trouve.")
    collection.delete(ids=results["ids"])
    return {"deleted": doc_id}
