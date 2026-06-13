// Electron packaged apps load from file://, so absolute /api paths don't resolve.
// On Vercel (https://) or dev (http://), /api routes to the serverless function or proxy.
const API =
  window.location.protocol === 'file:'
    ? (import.meta.env.VITE_API_URL ?? 'http://localhost:8000')
    : '/api';

// Injected by App.tsx once the user is authenticated.
let _tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: (() => Promise<string | null>) | null) {
  _tokenGetter = getter;
}

async function authHeaders(): Promise<HeadersInit> {
  if (!_tokenGetter) return {};
  const token = await _tokenGetter();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

interface HistoryEntry {
  role: string;
  content: string;
}

export async function* sendMessageStream(
  prompt: string,
  history: HistoryEntry[] = [],
  useCorpus = true,
  model?: string,
  signal?: AbortSignal,
  docId?: string,
) {
  const messages = history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  const response = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      message: prompt,
      history: messages,
      use_corpus: useCorpus,
      model,
      doc_id: docId ?? null,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? `Erreur serveur : ${response.status}`);
  }
  if (!response.body) throw new Error("Pas de réponse du serveur.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
}

export interface Document {
  id: string;
  name: string;
  chunks: number;
  word_count: number;
  indexed_at: string;
  path: string;
  category: string;
}

export interface CorpusStats {
  documents: number;
  chunks: number;
  words: number;
}

export interface ModelInfo {
  name: string;
  size: number;
  modified_at: string;
}

export interface ModelsResponse {
  default: string;
  models: ModelInfo[];
}

export interface IndexCorpusResponse {
  path: string;
  files: number;
  indexed: Document[];
  errors: Array<{ path: string; error: string }>;
}

export async function uploadDocument(
  file: File,
): Promise<Document> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API}/documents/upload`, {
    method: "POST",
    headers: await authHeaders(),
    body,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? "Erreur lors de l'indexation.");
  }
  return response.json();
}

export async function listDocuments(): Promise<Document[]> {
  const response = await fetch(`${API}/documents`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de charger les documents.");
  return response.json();
}

export async function getCorpusStats(): Promise<CorpusStats> {
  const response = await fetch(`${API}/documents/stats`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de charger le corpus.");
  return response.json();
}

export async function startIndexCorpus(): Promise<void> {
  const response = await fetch(`${API}/documents/index-corpus`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? "Erreur lors du démarrage de l'indexation.");
  }
}

export interface IndexStatus {
  running: boolean;
  done: number;
  total: number;
  errors: number;
  result: IndexCorpusResponse | null;
}

export async function getIndexStatus(): Promise<IndexStatus> {
  const response = await fetch(`${API}/documents/index-corpus/status`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de vérifier le statut.");
  return response.json();
}

export async function listModels(): Promise<ModelsResponse> {
  const response = await fetch(`${API}/models`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de charger les modeles.");
  return response.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`${API}/documents/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error("Impossible de supprimer le document.");
}

export interface ChunkItem {
  chunk: number;
  content: string;
}

export interface DocumentContent {
  id: string;
  name: string;
  content: string;
  word_count: number;
  chunks: number;
  chunks_list?: ChunkItem[];
}

export async function getDocumentContent(id: string): Promise<DocumentContent> {
  const response = await fetch(`${API}/documents/${id}/content`, { headers: await authHeaders() });
  if (!response.ok) throw new Error("Impossible de charger le contenu du document.");
  return response.json();
}
