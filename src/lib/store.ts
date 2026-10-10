import { WEB_MODE } from './api';
import { localStore } from './web';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const CONVERSATIONS_KEY = 'socrate.conversations';
const PREFERENCES_KEY = 'socrate.preferences';

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
  if (WEB_MODE) return localStore.readJson<FSConversation[]>(CONVERSATIONS_KEY, []);
  try {
    const res = await fetch(`${API}/conversations`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fsSaveConversation(conv: FSConversation): Promise<void> {
  if (WEB_MODE) {
    const others = localStore.readJson<FSConversation[]>(CONVERSATIONS_KEY, []).filter((c) => c.id !== conv.id);
    return localStore.writeJson(CONVERSATIONS_KEY, [conv, ...others]);
  }
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
  if (WEB_MODE) {
    const remaining = localStore.readJson<FSConversation[]>(CONVERSATIONS_KEY, []).filter((c) => c.id !== id);
    return localStore.writeJson(CONVERSATIONS_KEY, remaining);
  }
  try {
    await fetch(`${API}/conversations/${id}`, { method: 'DELETE' });
  } catch {
    // backend not yet reachable
  }
}

export async function fsLoadPreferences(): Promise<Partial<UserPreferences>> {
  if (WEB_MODE) return localStore.readJson<Partial<UserPreferences>>(PREFERENCES_KEY, {});
  try {
    const res = await fetch(`${API}/preferences`);
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export async function fsSavePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  if (WEB_MODE) {
    const current = localStore.readJson<Partial<UserPreferences>>(PREFERENCES_KEY, {});
    return localStore.writeJson(PREFERENCES_KEY, { ...current, ...prefs });
  }
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
