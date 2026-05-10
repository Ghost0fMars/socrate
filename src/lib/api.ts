const API = import.meta.env.VITE_API_URL ?? '/api';

interface HistoryEntry {
  role: string;
  content: string;
}

export async function* sendMessageStream(
  prompt: string,
  history: HistoryEntry[] = [],
) {
  const messages = history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role,
    content: m.content,
  }));

  const response = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt, history: messages }),
  });

  if (!response.ok) throw new Error(`Erreur serveur : ${response.status}`);
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
}

export async function uploadDocument(
  file: File,
): Promise<{ id: string; name: string; chunks: number }> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API}/documents/upload`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail ?? "Erreur lors de l'indexation.");
  }
  return response.json();
}

export async function listDocuments(): Promise<Document[]> {
  const response = await fetch(`${API}/documents`);
  if (!response.ok) throw new Error("Impossible de charger les documents.");
  return response.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`${API}/documents/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Impossible de supprimer le document.");
}
