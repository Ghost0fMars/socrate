// Mode web (vitrine) : documents, index vectoriel et conversations restent dans le
// navigateur du visiteur (IndexedDB / localStorage). Le serveur n'est qu'un relais
// vers Albert pour les embeddings et le chat.

const API = import.meta.env.VITE_API_URL ?? '/api';

const DB_NAME = 'socrate';
const DB_VERSION = 1;
const STORE = 'documents';
const EMBED_BATCH = 32;
const MIN_SIMILARITY = 0.4;

interface StoredChunk {
  chunk: number;
  content: string;
  vector: number[];
}

interface StoredDocument {
  id: string;
  name: string;
  content: string;
  word_count: number;
  indexed_at: string;
  chunks: StoredChunk[];
}

// ── IndexedDB ──────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const getAllDocs = () => withStore<StoredDocument[]>('readonly', (s) => s.getAll());
const getDoc = (id: string) => withStore<StoredDocument | undefined>('readonly', (s) => s.get(id));
const putDoc = (doc: StoredDocument) => withStore('readwrite', (s) => s.put(doc));
const removeDoc = (id: string) => withStore('readwrite', (s) => s.delete(id));

// ── Extraction, découpage, embeddings ─────────────────────────────────────────

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.text();
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      if (text.trim()) pages.push(`Page ${i}\n${text}`);
    }
    return pages.join('\n\n');
  }
  throw new Error('Format non supporte - PDF, DOCX, TXT ou MD uniquement.');
}

// Même découpage que le serveur local (360 mots, chevauchement de 60).
function chunkText(text: string, size = 360, overlap = 60): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '));
  }
  return chunks.filter((c) => c.trim());
}

async function embed(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const response = await fetch(`${API}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts.slice(i, i + EMBED_BATCH) }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail ?? `Erreur d'indexation : ${response.status}`);
    }
    vectors.push(...(await response.json()).embeddings);
  }
  return vectors;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function indexDocument(id: string, name: string, content: string): Promise<StoredDocument> {
  if (!content.trim()) throw new Error('Document vide ou illisible.');
  const texts = chunkText(content);
  const vectors = await embed(texts);
  const doc: StoredDocument = {
    id,
    name,
    content,
    word_count: content.split(/\s+/).filter(Boolean).length,
    indexed_at: new Date().toISOString(),
    chunks: texts.map((text, i) => ({ chunk: i + 1, content: text, vector: vectors[i] })),
  };
  await putDoc(doc);
  return doc;
}

function toDocument(doc: StoredDocument) {
  return {
    id: doc.id,
    name: doc.name,
    chunks: doc.chunks.length,
    word_count: doc.word_count,
    indexed_at: doc.indexed_at,
    path: '',
    category: '',
  };
}

// ── API équivalente à celle du serveur local ──────────────────────────────────

export async function uploadDocument(file: File) {
  const content = await extractText(file);
  return toDocument(await indexDocument(crypto.randomUUID(), file.name, content));
}

export async function createDocument(name: string, content: string) {
  const fileName = /\.\w+$/.test(name) ? name : `${name}.md`;
  return toDocument(await indexDocument(crypto.randomUUID(), fileName, content || `# ${name}\n`));
}

export async function updateDocumentContent(id: string, content: string) {
  const existing = await getDoc(id);
  if (!existing) throw new Error('Document non trouvé.');
  return toDocument(await indexDocument(id, existing.name, content || `# ${existing.name}`));
}

export async function listDocuments() {
  const docs = await getAllDocs();
  return docs
    .sort((a, b) => b.indexed_at.localeCompare(a.indexed_at))
    .map(toDocument);
}

export async function getCorpusStats() {
  const docs = await getAllDocs();
  return {
    documents: docs.length,
    chunks: docs.reduce((n, d) => n + d.chunks.length, 0),
    words: docs.reduce((n, d) => n + d.word_count, 0),
  };
}

export async function deleteDocument(id: string) {
  await removeDoc(id);
}

export async function getDocumentContent(id: string) {
  const doc = await getDoc(id);
  if (!doc) throw new Error('Impossible de charger le contenu du document.');
  return {
    id: doc.id,
    name: doc.name,
    content: doc.content,
    word_count: doc.word_count,
    chunks: doc.chunks.length,
    chunks_list: doc.chunks.map(({ chunk, content }) => ({ chunk, content })),
  };
}

export async function retrieveContext(query: string, docId?: string, nResults = 4): Promise<string> {
  const docs = (await getAllDocs()).filter((d) => !docId || d.id === docId);
  if (docs.length === 0) return '';
  const [queryVector] = await embed([query]);
  const scored = docs.flatMap((doc) =>
    doc.chunks.map((c) => ({ doc, c, score: cosine(queryVector, c.vector) })),
  );
  return scored
    .filter((s) => docId || s.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, nResults)
    .map((s) => `[source: ${s.doc.name} | extrait: ${s.c.chunk}]\n${s.c.content}`)
    .join('\n\n---\n\n');
}

// ── Conversations et préférences (localStorage) ───────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible (navigation privée, quota)
  }
}

export const localStore = { readJson, writeJson };
