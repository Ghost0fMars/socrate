import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  getDoc,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from './firebase';

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

// ── Conversations ────────────────────────────────────────────────────────────

function convsRef(uid: string) {
  return collection(db, 'users', uid, 'conversations');
}

export async function fsLoadConversations(uid: string): Promise<FSConversation[]> {
  const q = query(convsRef(uid), orderBy('updatedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as FSConversation);
}

export async function fsSaveConversation(uid: string, conv: FSConversation): Promise<void> {
  await setDoc(doc(convsRef(uid), conv.id), conv);
}

export async function fsDeleteConversation(uid: string, convId: string): Promise<void> {
  await deleteDoc(doc(convsRef(uid), convId));
}

// ── Préférences ──────────────────────────────────────────────────────────────

function prefsDoc(uid: string) {
  return doc(db, 'users', uid, 'preferences', 'default');
}

export async function fsLoadPreferences(uid: string): Promise<Partial<UserPreferences>> {
  const snap = await getDoc(prefsDoc(uid));
  return snap.exists() ? (snap.data() as UserPreferences) : {};
}

export async function fsSavePreferences(uid: string, prefs: Partial<UserPreferences>): Promise<void> {
  await setDoc(prefsDoc(uid), prefs, { merge: true });
}
