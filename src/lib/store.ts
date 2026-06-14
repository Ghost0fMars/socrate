const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface FSConversation {
  id: string;
  title: string;
  model: string;
  messages: Array<{ id: string; role: string; content: string }>;
  updatedAt: number;
}

export interface UserPreferences {
  theme: string;
  model: string;
}

export async function fsLoadConversations(): Promise<FSConversation[]> {
  try {
    const res = await fetch(`${API}/conversations`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fsSaveConversation(conv: FSConversation): Promise<void> {
  try {
    await fetch(`${API}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conv),
    });
  } catch {
    // backend not yet reachable
  }
}

export async function fsDeleteConversation(id: string): Promise<void> {
  try {
    await fetch(`${API}/conversations/${id}`, { method: 'DELETE' });
  } catch {
    // backend not yet reachable
  }
}

export async function fsLoadPreferences(): Promise<Partial<UserPreferences>> {
  try {
    const res = await fetch(`${API}/preferences`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export async function fsSavePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  try {
    await fetch(`${API}/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
  } catch {
    // backend not yet reachable
  }
}
