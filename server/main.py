import io
import os
import pathlib
import uuid

import chromadb
import ollama
import pypdf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ollama import AsyncClient
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

CHAT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

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
    history: list[ChatMessage] = []


def chunk_text(text: str, chunk_size: int = 400, overlap: int = 50) -> list[str]:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return [c for c in chunks if c.strip()]


def get_embedding(text: str) -> list[float]:
    response = ollama.embeddings(model=EMBED_MODEL, prompt=text)
    return list(response["embedding"])


def retrieve_context(query: str, n_results: int = 4) -> str:
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
        parts.append(f"[{source}]\n{doc}")
    return "\n\n---\n\n".join(parts)


@app.post("/chat")
async def chat(request: ChatRequest):
    context = retrieve_context(request.message)

    system_prompt = "Tu es un assistant utile, concis et poli. Réponds en français."
    if context:
        system_prompt += (
            "\n\nContexte extrait des documents indexés — utilise-le si pertinent :\n\n"
            + context
        )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in request.history:
        role = "assistant" if msg.role == "model" else msg.role
        messages.append({"role": role, "content": msg.content})
    messages.append({"role": "user", "content": request.message})

    async def generate():
        async for chunk in await AsyncClient().chat(
            model=CHAT_MODEL, messages=messages, stream=True
        ):
            content = chunk.message.content
            if content:
                yield content

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    content = await file.read()
    filename = file.filename or "document"

    if filename.lower().endswith(".pdf"):
        reader = pypdf.PdfReader(io.BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif filename.lower().endswith((".txt", ".md")):
        text = content.decode("utf-8", errors="replace")
    else:
        raise HTTPException(
            status_code=400, detail="Format non supporté — PDF, TXT ou MD uniquement."
        )

    if not text.strip():
        raise HTTPException(status_code=400, detail="Document vide ou illisible.")

    chunks = chunk_text(text)
    doc_id = str(uuid.uuid4())

    ids, embeddings, documents, metadatas = [], [], [], []
    for i, chunk in enumerate(chunks):
        ids.append(f"{doc_id}_{i}")
        embeddings.append(get_embedding(chunk))
        documents.append(chunk)
        metadatas.append({"source": filename, "doc_id": doc_id, "chunk": i})

    collection.add(
        embeddings=embeddings, ids=ids, documents=documents, metadatas=metadatas
    )

    return {"id": doc_id, "name": filename, "chunks": len(chunks)}


@app.get("/documents")
async def list_documents():
    if collection.count() == 0:
        return []
    results = collection.get(include=["metadatas"])
    seen: dict[str, str] = {}
    for meta in results["metadatas"]:
        doc_id = meta.get("doc_id", "")
        if doc_id and doc_id not in seen:
            seen[doc_id] = meta.get("source", "Inconnu")
    return [{"id": k, "name": v} for k, v in seen.items()]


@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    results = collection.get(where={"doc_id": doc_id})
    if not results["ids"]:
        raise HTTPException(status_code=404, detail="Document non trouvé.")
    collection.delete(ids=results["ids"])
    return {"deleted": doc_id}
