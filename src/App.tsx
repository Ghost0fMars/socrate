/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { BookOpen, Loader2, FileText, Trash2, UploadCloud, X, Download, History, Plus, Eye, Sun, Moon, LogOut, LogIn, Pencil, FilePlus } from "lucide-react";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import {
  sendMessageStream,
  uploadDocument,
  listDocuments,
  deleteDocument,
  getCorpusStats,
  startIndexCorpus,
  getIndexStatus,
  listModels,
  getDocumentContent,
  updateDocumentContent,
  createDocument,
  type Document,
  type CorpusStats,
  type ModelInfo,
} from "./lib/api";
import { useAuth } from "./lib/auth";
import {
  fsLoadConversations,
  fsSaveConversation,
  fsDeleteConversation,
  fsLoadPreferences,
  fsSavePreferences,
  type FSConversation,
} from "./lib/firestore";
import AuthScreen from "./components/AuthScreen";

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  updatedAt: number;
}

const MODEL_LABELS: Record<string, string> = {
  // Modèles locaux (Ollama)
  "qwen3:14b": "Reflexion",
  "gemma3:12b": "Fiction",
  // Modèles OpenAI en ligne
  "o4-mini": "OpenAI o4-mini",
  "o3-mini": "OpenAI o3-mini",
  "o3": "OpenAI o3",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4.1": "GPT-4.1",
  "gpt-4.1-mini": "GPT-4.1 mini",
  "gpt-4.1-nano": "GPT-4.1 nano",
};

const getModelLabel = (name: string) => MODEL_LABELS[name] ?? name;

export default function App() {
  const { user, loading: authLoading, logOut } = useAuth();

  const [showAuth, setShowAuth] = useState(false);

  // Dismiss auth screen as soon as the user is logged in
  useEffect(() => {
    if (user) setShowAuth(false);
  }, [user]);

  const [theme, setTheme] = useState("light");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Track whether preferences have been loaded from Firestore to avoid
  // writing back defaults before the load completes.
  const prefsLoadedRef = useRef(false);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const indexPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOnline = window.location.protocol !== "file:" && !window.location.hostname.includes("localhost");

  const [showDocs, setShowDocs] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [corpusStats, setCorpusStats] = useState<CorpusStats>({
    documents: 0,
    chunks: 0,
    words: 0,
  });
  const [useCorpus, setUseCorpus] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [indexingCorpus, setIndexingCorpus] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [indexMessage, setIndexMessage] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [readerTab, setReaderTab] = useState<"text" | "chat">("text");
  const [docContent, setDocContent] = useState("");
  const [docChunks, setDocChunks] = useState<any[]>([]);
  const [docContentLoading, setDocContentLoading] = useState(false);
  const [docMessages, setDocMessages] = useState<Message[]>([]);
  const [docInput, setDocInput] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const docScrollRef = useRef<HTMLDivElement>(null);
  const docAbortControllerRef = useRef<AbortController | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocContent, setNewDocContent] = useState("");
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [createDocError, setCreateDocError] = useState("");

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("fr-FR").format(value);

  // ── Load preferences + conversations when user logs in ──────────────────────

  useEffect(() => {
    if (!user) {
      prefsLoadedRef.current = false;
      setConversations([]);
      setCurrentConvId(null);
      setMessages([]);
      return;
    }

    // Load preferences
    fsLoadPreferences(user.uid).then((prefs) => {
      if (prefs.theme) setTheme(prefs.theme);
      if (prefs.model) setSelectedModel(prefs.model);
      prefsLoadedRef.current = true;
    }).catch(console.error);

    // Load conversations
    fsLoadConversations(user.uid).then((convs) => {
      setConversations(convs as Conversation[]);
    }).catch(console.error);
  }, [user]);

  // ── Persist preferences on change (after initial load) ─────────────────────

  useEffect(() => {
    if (!user || !prefsLoadedRef.current) return;
    fsSavePreferences(user.uid, { theme }).catch(console.error);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !prefsLoadedRef.current || !selectedModel) return;
    fsSavePreferences(user.uid, { model: selectedModel }).catch(console.error);
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      docAbortControllerRef.current?.abort();
      if (indexPollRef.current) clearInterval(indexPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (docScrollRef.current) {
      docScrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [docMessages]);

  // ── Auto-save conversation to Firestore ─────────────────────────────────────

  useEffect(() => {
    if (messages.length === 0 || !user) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? "…" : "")
      : "Conversation";

    const id = currentConvId ?? Date.now().toString();
    if (!currentConvId) setCurrentConvId(id);

    const conv: Conversation = { id, title, model: selectedModel, messages, updatedAt: Date.now() };

    setConversations((prev) => {
      const exists = prev.some((c) => c.id === id);
      return exists ? prev.map((c) => (c.id === id ? conv : c)) : [conv, ...prev];
    });

    fsSaveConversation(user.uid, conv as FSConversation).catch(console.error);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Documents ───────────────────────────────────────────────────────────────

  const loadDocuments = useCallback(async () => {
    try {
      const [docs, stats] = await Promise.all([listDocuments(), getCorpusStats()]);
      setDocuments(docs);
      setCorpusStats(stats);
    } catch {
      // backend not yet reachable on first load
    }
  }, []);

  useEffect(() => {
    if (user || !isOnline) loadDocuments();
  }, [loadDocuments, user, isOnline]);

  const loadModels = useCallback(async () => {
    try {
      const response = await listModels();
      setModels(response.models);
      setSelectedModel((current) => {
        if (current && response.models.some((model) => model.name === current)) {
          return current;
        }
        if (response.models.some((model) => model.name === response.default)) {
          return response.default;
        }
        return response.models[0]?.name ?? response.default;
      });
    } catch {
      // backend not yet reachable on first load
    }
  }, []);

  useEffect(() => {
    if (user || !isOnline) loadModels();
  }, [loadModels, user, isOnline]);

  // ── Conversation actions ────────────────────────────────────────────────────

  const handleNewConversation = () => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setCurrentConvId(null);
    setInputValue("");
    setIsLoading(false);
  };

  const handleLoadConversation = (conv: Conversation) => {
    abortControllerRef.current?.abort();
    setMessages(conv.messages);
    setCurrentConvId(conv.id);
    setSelectedModel(conv.model || selectedModel);
    setIsLoading(false);
    setShowHistory(false);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConvId === id) {
      setMessages([]);
      setCurrentConvId(null);
    }
    if (user) fsDeleteConversation(user.uid, id).catch(console.error);
  };

  // ── Document upload/indexing ────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError("");
    setIndexMessage("");
    try {
      await uploadDocument(file);
      await loadDocuments();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await deleteDocument(id);
      await loadDocuments();
    } catch {
      // ignore
    }
  };

  const handleIndexCorpus = async () => {
    setIndexingCorpus(true);
    setUploadError("");
    setIndexMessage("Démarrage de l'indexation...");
    try {
      await startIndexCorpus();
      indexPollRef.current = setInterval(async () => {
        try {
          const status = await getIndexStatus();
          if (status.total > 0) {
            setIndexMessage(`${status.done} / ${status.total} fichiers indexés...`);
          }
          if (!status.running) {
            clearInterval(indexPollRef.current!);
            indexPollRef.current = null;
            setIndexingCorpus(false);
            await loadDocuments();
            if (status.result) {
              setIndexMessage(
                `${status.result.indexed.length} / ${status.result.files} fichiers indexés depuis SocrateCorpus.`,
              );
              if (status.result.errors.length > 0) {
                setUploadError(`${status.result.errors.length} fichier(s) non lisibles.`);
              }
            }
          }
        } catch {
          clearInterval(indexPollRef.current!);
          indexPollRef.current = null;
          setIndexingCorpus(false);
        }
      }, 2000);
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Erreur inconnue.");
      setIndexingCorpus(false);
    }
  };

  const handleExport = (content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `socrate_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  };

  const handleViewDoc = async (doc: Document) => {
    setViewingDoc(doc);
    setReaderTab("text");
    setDocContent("");
    setDocChunks([]);
    setDocMessages([]);
    setDocInput("");
    setDocContentLoading(true);
    setEditMode(false);
    setEditError("");
    try {
      const result = await getDocumentContent(doc.id);
      setDocContent(result.content);
      setDocChunks(result.chunks_list ?? []);
    } catch {
      setDocContent("Erreur lors du chargement du contenu.");
      setDocChunks([]);
    } finally {
      setDocContentLoading(false);
    }
  };

  const handleCitationClick = async (docName: string, chunkIndex: number) => {
    const targetDoc = documents.find(
      (d) =>
        d.name.toLowerCase() === docName.toLowerCase() ||
        d.name.toLowerCase().includes(docName.toLowerCase()) ||
        docName.toLowerCase().includes(d.name.toLowerCase())
    );
    if (!targetDoc) return;

    await handleViewDoc(targetDoc);
    setReaderTab("text");

    setTimeout(() => {
      const element = document.getElementById(`doc-chunk-${chunkIndex}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("citation-highlight");
        setTimeout(() => {
          element.classList.remove("citation-highlight");
        }, 3500);
      }
    }, 600);
  };

  const processCitations = (text: string) => {
    const regex = /\[source:\s*([^|\]]+)(?:\s*\|\s*extrait:\s*(\d+))?\]/gi;
    return text.replace(regex, (match, fileName, chunkStr) => {
      const chunk = chunkStr ? parseInt(chunkStr, 10) : 1;
      const label = fileName.trim();
      const encodedName = encodeURIComponent(label).replace(/\./g, "%2E");
      return `[${label} (Extrait ${chunk})](#citation-${encodedName}-${chunk})`;
    });
  };

  const handleDocStop = () => {
    docAbortControllerRef.current?.abort();
    docAbortControllerRef.current = null;
    setDocLoading(false);
  };

  const handleEditDoc = () => {
    setEditMode(true);
    setEditContent(docContent);
    setEditError("");
    setReaderTab("text");
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditError("");
  };

  const handleSaveDoc = async () => {
    if (!viewingDoc || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updatedDoc = await updateDocumentContent(viewingDoc.id, editContent);
      setViewingDoc(updatedDoc);
      const result = await getDocumentContent(updatedDoc.id);
      setDocContent(result.content);
      setDocChunks(result.chunks_list ?? []);
      await loadDocuments();
      setEditMode(false);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : "Erreur lors de la sauvegarde.");
    } finally {
      setEditSaving(false);
    }
  };

  const handleCreateDoc = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newDocName.trim() || creatingDoc) return;
    setCreatingDoc(true);
    setCreateDocError("");
    try {
      const doc = await createDocument(newDocName.trim(), newDocContent);
      await loadDocuments();
      setNewDocName("");
      setNewDocContent("");
      setShowCreateDoc(false);
      await handleViewDoc(doc);
    } catch (e: unknown) {
      setCreateDocError(e instanceof Error ? e.message : "Erreur lors de la création.");
    } finally {
      setCreatingDoc(false);
    }
  };

  const handleDocQuestion = async (e?: React.SyntheticEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!docInput.trim() || docLoading || !viewingDoc) return;

    const question = docInput;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
    };
    setDocMessages((prev) => [...prev, userMessage]);
    setDocInput("");
    setDocLoading(true);

    const botMessageId = (Date.now() + 1).toString();
    const abortController = new AbortController();
    docAbortControllerRef.current = abortController;
    const history = docMessages.map((m) => ({ role: m.role, content: m.content }));

    try {
      let accumulated = "";
      const stream = sendMessageStream(
        question,
        history,
        true,
        selectedModel,
        abortController.signal,
        viewingDoc.id,
      );
      for await (const chunk of stream) {
        accumulated += chunk;
        setDocMessages((prev) => {
          const exists = prev.find((m) => m.id === botMessageId);
          if (exists) {
            return prev.map((m) => m.id === botMessageId ? { ...m, content: accumulated } : m);
          }
          return [...prev, { id: botMessageId, role: "model", content: accumulated }];
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const msg = error instanceof Error ? error.message : String(error);
      setDocMessages((prev) => [
        ...prev,
        { id: "doc-error", role: "model", content: `Une erreur est survenue : ${msg}` },
      ]);
    } finally {
      if (docAbortControllerRef.current === abortController) {
        docAbortControllerRef.current = null;
      }
      setDocLoading(false);
    }
  };

  const handleSubmit = async (e?: React.SyntheticEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    const botMessageId = (Date.now() + 1).toString();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      let accumulated = "";
      const stream = sendMessageStream(
        inputValue,
        history,
        useCorpus,
        selectedModel,
        abortController.signal,
      );

      for await (const chunk of stream) {
        accumulated += chunk;
        setMessages((prev) => {
          const exists = prev.find((m) => m.id === botMessageId);
          if (exists) {
            return prev.map((m) =>
              m.id === botMessageId ? { ...m, content: accumulated } : m,
            );
          }
          return [
            ...prev,
            { id: botMessageId, role: "model", content: accumulated },
          ];
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Chat error:", msg);
      setMessages((prev) => [
        ...prev,
        {
          id: "error",
          role: "model",
          content: `Une erreur est survenue : ${msg}`,
        },
      ]);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  // ── Auth loading / gate ─────────────────────────────────────────────────────
  // In local mode (localhost / Electron) the app opens without login.
  // In online mode (deployed) Firebase auth is required.

  if (authLoading && isOnline) {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-[#FDFCFA] dark:bg-[#0D0D0C]">
        <Loader2 size={20} className="animate-spin text-[#8C8C8C]" />
      </div>
    );
  }

  if ((!user && isOnline) || showAuth) {
    return <AuthScreen />;
  }

  // ── Main UI ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-full bg-[#FDFCFA] text-[#1A1A1A] overflow-hidden">
      {/* Mobile Header */}
      <header className="md:hidden h-14 border-b border-[#E5E2DD] bg-[#FDFCFA] dark:bg-[#0D0D0C] flex items-center justify-between px-4 shrink-0 z-20">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
          title="Historique"
        >
          <History size={18} />
        </button>

        <span className="text-xs tracking-[0.25em] font-semibold text-[#1A1A1A] dark:text-[#ECEAE4] select-none">
          S0CR4T3
        </span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
            title={theme === "light" ? "Mode Sombre" : "Mode Clair"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          <button
            onClick={() => setShowDocs((v) => !v)}
            className="p-2 text-[#8C8C8C] hover:text-black dark:text-[#A6A196] dark:hover:text-white transition-colors"
            title="Documents"
          >
            <FileText size={18} />
          </button>
        </div>
      </header>

      {/* App Body Container */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Left Navigation */}
        <nav className="hidden md:flex w-20 border-r border-[#E5E2DD] flex-col items-center justify-between py-10 shrink-0">
          <div className="flex flex-col items-center gap-8">
            <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center">
              <div className="w-3 h-3 bg-white rotate-45"></div>
            </div>
            <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase [writing-mode:vertical-rl] rotate-180">
              S0CR4T3
            </span>
          </div>

          <div className="flex flex-col items-center gap-6">
            {/* Toggle Theme */}
            <button
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
              title={theme === "light" ? "Mode Sombre" : "Mode Clair"}
              className="flex flex-col items-center gap-1 group transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            >
              {theme === "light" ? (
                <Moon
                  size={18}
                  className="text-[#CBC7C0] group-hover:text-black transition-colors"
                />
              ) : (
                <Sun
                  size={18}
                  className="text-[#8C8C8C] group-hover:text-white transition-colors"
                />
              )}
            </button>

            {/* New conversation */}
            <button
              onClick={handleNewConversation}
              title="Nouvelle conversation"
              className="flex flex-col items-center gap-1 group"
            >
              <Plus
                size={18}
                className="text-[#CBC7C0] group-hover:text-black transition-colors"
              />
            </button>

            {/* History toggle */}
            <button
              onClick={() => { setShowHistory((v) => !v); setShowDocs(false); }}
              title="Historique"
              className="relative flex flex-col items-center gap-1 group"
            >
              <History
                size={18}
                className={`transition-colors ${showHistory ? "text-black" : "text-[#CBC7C0] group-hover:text-black"}`}
              />
              {conversations.length > 0 && (
                <span className="text-[9px] font-bold tracking-widest text-[#8C8C8C]">
                  {conversations.length}
                </span>
              )}
            </button>

            {/* Document toggle */}
            <button
              onClick={() => { setShowDocs((v) => !v); setShowHistory(false); }}
              title="Documents indexés"
              className="relative flex flex-col items-center gap-1 group"
            >
              <FileText
                size={18}
                className={`transition-colors ${showDocs ? "text-black" : "text-[#CBC7C0] group-hover:text-black"}`}
              />
              {documents.length > 0 && (
                <span className="text-[9px] font-bold tracking-widest text-[#8C8C8C]">
                  {documents.length}
                </span>
              )}
            </button>

            {/* Login / Logout */}
            {user ? (
              <button
                onClick={logOut}
                title={`Déconnexion (${user.email})`}
                className="flex flex-col items-center gap-1 group"
              >
                <LogOut
                  size={18}
                  className="text-[#CBC7C0] group-hover:text-red-400 transition-colors"
                />
              </button>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                title="Se connecter pour synchroniser"
                className="flex flex-col items-center gap-1 group"
              >
                <LogIn
                  size={18}
                  className="text-[#CBC7C0] group-hover:text-[#8C8C8C] transition-colors"
                />
              </button>
            )}
          </div>
        </nav>

        {/* Backdrop overlay for mobile when History or Docs are open */}
        <AnimatePresence>
          {(showHistory || showDocs) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowHistory(false);
                setShowDocs(false);
              }}
              className="md:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-xs"
            />
          )}
        </AnimatePresence>

        {/* History Panel */}
        <AnimatePresence>
          {showHistory && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ ease: "easeInOut", duration: 0.3 }}
              className="border-r border-[#E5E2DD] flex flex-col overflow-hidden shrink-0 bg-[#FDFCFA] fixed md:static inset-y-0 left-0 z-40 w-[280px] md:w-[280px] shadow-2xl md:shadow-none h-full"
            >
              <div className="flex items-center justify-between px-6 py-6 border-b border-[#E5E2DD]">
                <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">
                  Historique
                </span>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-[#CBC7C0] hover:text-black transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-1">
                {conversations.length === 0 ? (
                  <p className="text-[11px] text-[#CBC7C0] italic mt-4 px-2">
                    Aucune conversation sauvegardée.
                  </p>
                ) : (
                  conversations
                    .slice()
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                    .map((conv) => (
                      <div
                        key={conv.id}
                        onClick={() => handleLoadConversation(conv)}
                        className={`flex items-start justify-between gap-2 px-3 py-3 rounded-sm cursor-pointer group transition-colors ${
                          currentConvId === conv.id
                            ? "bg-[#F0EDE9]"
                            : "hover:bg-[#F5F2EF]"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-[#1A1A1A] truncate leading-snug">
                            {conv.title}
                          </p>
                          <p className="text-[10px] text-[#CBC7C0] mt-1">
                            {getModelLabel(conv.model)} · {formatDate(conv.updatedAt)}
                          </p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                          className="text-[#E5E2DD] hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 mt-0.5"
                          title="Supprimer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                )}
              </div>

              {/* User info + logout (mobile) */}
              <div className="px-6 py-4 border-t border-[#E5E2DD] flex items-center justify-between">
                <span className="text-[10px] text-[#8C8C8C] truncate max-w-[160px]">
                  {user?.email ?? 'Mode local'}
                </span>
                {user ? (
                  <button
                    onClick={logOut}
                    className="text-[#CBC7C0] hover:text-red-400 transition-colors"
                    title="Déconnexion"
                  >
                    <LogOut size={13} />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAuth(true)}
                    className="text-[#CBC7C0] hover:text-[#8C8C8C] transition-colors"
                    title="Se connecter"
                  >
                    <LogIn size={13} />
                  </button>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Chat */}
        <main className="flex-1 flex flex-col relative h-full min-w-0">
          <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-32 py-8 md:py-16 space-y-12 md:space-y-24 scroll-smooth">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-2xl w-full group/msg ${message.role === "user" ? "text-right ml-auto" : "text-left mr-auto"}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[10px] tracking-widest text-[#8C8C8C] uppercase font-semibold">
                        {message.role === "user" ? "Vous" : "L'Esprit"}
                      </p>
                      {message.role === "model" && (
                        <button
                          onClick={() => handleExport(message.content)}
                          title="Exporter en .txt"
                          className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-[#CBC7C0] hover:text-black"
                        >
                          <Download size={13} />
                        </button>
                      )}
                    </div>
                    <div
                      className={`markdown-body ${message.role === "user" ? "text-xl md:text-2xl font-light leading-snug" : "text-base md:text-lg leading-relaxed font-light"}`}
                    >
                      {message.role === "user" ? (
                        <span className="font-light">{message.content}</span>
                      ) : (
                        <Markdown
                          components={{
                            a: ({ href, children, ...props }) => {
                              if (href && href.startsWith("#citation-")) {
                                const parts = href.replace("#citation-", "").split("-");
                                const docName = decodeURIComponent(parts[0]);
                                const chunkIndex = parseInt(parts[1], 10);
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowDocs(true);
                                      handleCitationClick(docName, chunkIndex);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded bg-[#F5F2EF] hover:bg-[#E5E2DD] text-[#4A4A4A] dark:bg-[#20201D] dark:hover:bg-[#2E2E2A] dark:text-[#ECEAE4] border border-[#E5E2DD] dark:border-[#2D2D29] text-[11px] font-semibold cursor-pointer transition-colors shadow-sm"
                                  >
                                    <BookOpen size={10} className="text-[#8C8C8C] shrink-0" />
                                    <span className="font-serif italic truncate max-w-28">{docName.split('.')[0]}</span>
                                    <span className="text-[9px] text-[#8C8C8C] dark:text-[#A6A196]">p. {chunkIndex}</span>
                                  </button>
                                );
                              }
                              return (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline text-black dark:text-white font-medium hover:opacity-80"
                                  {...props}
                                >
                                  {children}
                                </a>
                              );
                            }
                          }}
                        >
                          {processCitations(message.content)}
                        </Markdown>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={scrollRef} />
          </div>

          <div className="h-auto min-h-20 py-4 md:py-0 md:h-28 px-6 md:px-24 flex items-center border-t border-[#E5E2DD] bg-[#FDFCFA]">
            <form
              onSubmit={handleSubmit}
              className="w-full flex flex-col md:flex-row md:items-center gap-3 md:gap-4 group"
            >
              <div className="flex items-center gap-3 md:gap-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setUseCorpus((v) => !v)}
                  disabled={documents.length === 0}
                  title={useCorpus ? "Corpus actif" : "Corpus inactif"}
                  className={`h-8 w-8 shrink-0 border flex items-center justify-center transition-colors disabled:opacity-30 ${
                    useCorpus && documents.length > 0
                      ? "border-black text-black bg-[#F5F2EF]"
                      : "border-[#E5E2DD] text-[#CBC7C0] hover:text-black"
                  }`}
                >
                  <BookOpen size={13} />
                </button>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={models.length === 0 || isLoading}
                  title="Modele Ollama"
                  className="h-8 max-w-40 shrink-0 border border-[#E5E2DD] px-2 text-[10px] tracking-widest uppercase text-[#8C8C8C] outline-none transition-colors hover:border-[#CBC7C0] disabled:opacity-30 appearance-none bg-white dark:bg-black"
                >
                  {models.length === 0 ? (
                    <option value="">Aucun modele</option>
                  ) : (
                    models.map((model) => (
                      <option key={model.name} value={model.name}>
                        {getModelLabel(model.name)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex-1 flex items-center gap-3 md:gap-4 min-w-0">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Écrivez votre message..."
                  disabled={isLoading}
                  className="bg-transparent min-w-0 flex-1 text-base md:text-[11px] font-light placeholder:italic placeholder:text-[#CBC7C0] outline-none disabled:opacity-30"
                />
                <button
                  type={isLoading ? "button" : "submit"}
                  onClick={isLoading ? handleStop : undefined}
                  disabled={!isLoading && !inputValue.trim()}
                  className={`ml-auto flex items-center gap-3 text-[10px] tracking-[0.18em] font-bold transition-colors disabled:opacity-20 uppercase whitespace-nowrap ${
                    isLoading
                      ? "text-red-400 hover:text-red-500"
                      : "group-hover:text-black text-[#8C8C8C]"
                  }`}
                >
                  {isLoading ? (
                    "STOP"
                  ) : (
                    "ENVOYER"
                  )}
                  <div className="w-6 md:w-12 h-[1px] bg-current"></div>
                </button>
              </div>
            </form>
          </div>
        </main>

        {/* Document Panel */}
        <AnimatePresence>
          {showDocs && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ ease: "easeInOut", duration: 0.3 }}
              className="border-l border-[#E5E2DD] flex flex-col overflow-hidden shrink-0 bg-[#FDFCFA] fixed md:static inset-y-0 right-0 z-40 w-full sm:w-[320px] md:w-[320px] shadow-2xl md:shadow-none h-full"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-6 py-6 border-b border-[#E5E2DD]">
                <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">
                  Corpus
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowCreateDoc((v) => !v)}
                    className="text-[#CBC7C0] hover:text-black transition-colors"
                    title="Nouveau document"
                  >
                    <FilePlus size={14} />
                  </button>
                  <button
                    onClick={() => setShowDocs(false)}
                    className="text-[#CBC7C0] hover:text-black transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Create document form */}
              {showCreateDoc && (
                <form
                  onSubmit={handleCreateDoc}
                  className="px-6 py-4 border-b border-[#E5E2DD] space-y-2 bg-[#F5F2EF] dark:bg-[#1A1A17]"
                >
                  <input
                    type="text"
                    value={newDocName}
                    onChange={(e) => setNewDocName(e.target.value)}
                    placeholder="Nom du document..."
                    autoFocus
                    className="w-full bg-white dark:bg-[#0D0D0C] border border-[#E5E2DD] dark:border-[#2D2D29] px-3 py-2 text-[12px] text-[#1A1A1A] dark:text-[#ECEAE4] outline-none"
                  />
                  <textarea
                    value={newDocContent}
                    onChange={(e) => setNewDocContent(e.target.value)}
                    placeholder="Contenu initial..."
                    rows={3}
                    className="w-full bg-white dark:bg-[#0D0D0C] border border-[#E5E2DD] dark:border-[#2D2D29] px-3 py-2 text-[12px] text-[#1A1A1A] dark:text-[#ECEAE4] outline-none resize-none"
                  />
                  {createDocError && (
                    <p className="text-[11px] text-red-400">{createDocError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateDoc(false);
                        setNewDocName("");
                        setNewDocContent("");
                        setCreateDocError("");
                      }}
                      className="flex-1 h-7 border border-[#E5E2DD] text-[10px] tracking-widest uppercase text-[#8C8C8C] hover:border-[#CBC7C0] hover:text-black transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={!newDocName.trim() || creatingDoc}
                      className="flex-1 h-7 bg-black dark:bg-white text-white dark:text-black text-[10px] tracking-widest uppercase font-semibold disabled:opacity-30 flex items-center justify-center"
                    >
                      {creatingDoc ? <Loader2 size={12} className="animate-spin" /> : "Créer"}
                    </button>
                  </div>
                </form>
              )}

            <div className="grid grid-cols-3 border-b border-[#E5E2DD]">
              <div className="px-4 py-4 border-r border-[#E5E2DD]">
                <p className="text-[9px] tracking-widest text-[#CBC7C0] uppercase">
                  Docs
                </p>
                <p className="text-lg font-light">{corpusStats.documents}</p>
              </div>
              <div className="px-4 py-4 border-r border-[#E5E2DD]">
                <p className="text-[9px] tracking-widest text-[#CBC7C0] uppercase">
                  Extraits
                </p>
                <p className="text-lg font-light">{corpusStats.chunks}</p>
              </div>
              <div className="px-4 py-4">
                <p className="text-[9px] tracking-widest text-[#CBC7C0] uppercase">
                  Mots
                </p>
                <p className="text-lg font-light">
                  {formatNumber(corpusStats.words)}
                </p>
              </div>
            </div>

            {/* Upload zone */}
            <div className="px-6 py-5 border-b border-[#E5E2DD]">
              {!isOnline && (
                <button
                  type="button"
                  onClick={handleIndexCorpus}
                  disabled={indexingCorpus || uploading}
                  className="mb-4 flex h-8 w-full items-center justify-center gap-2 border border-[#E5E2DD] text-[10px] font-semibold uppercase tracking-widest text-[#8C8C8C] transition-colors hover:border-[#CBC7C0] hover:text-black disabled:opacity-30"
                >
                  {indexingCorpus ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <BookOpen size={12} />
                  )}
                  {indexingCorpus ? "Indexation du dossier..." : "Indexer SocrateCorpus"}
                </button>
              )}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 border border-dashed rounded-sm py-7 cursor-pointer transition-colors ${
                  dragOver
                    ? "border-black bg-[#F5F2EF]"
                    : "border-[#E5E2DD] hover:border-[#CBC7C0]"
                }`}
              >
                {uploading ? (
                  <Loader2 size={20} className="animate-spin text-[#8C8C8C]" />
                ) : (
                  <UploadCloud size={20} className="text-[#CBC7C0]" />
                )}
                <span className="text-[11px] tracking-widest text-[#8C8C8C] uppercase font-semibold">
                  {uploading ? "Indexation..." : "Déposer un fichier"}
                </span>
                <span className="text-[10px] text-[#CBC7C0]">
                  PDF / DOCX / TXT / MD
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={handleFileInput}
              />
              {uploadError && (
                <p className="mt-3 text-[11px] text-red-400">{uploadError}</p>
              )}
              {indexMessage && (
                <p className="mt-3 text-[11px] text-[#8C8C8C]">{indexMessage}</p>
              )}
            </div>

            {/* Document list */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-2">
              {documents.length === 0 ? (
                <p className="text-[11px] text-[#CBC7C0] italic mt-4">
                  Aucun document indexé.
                </p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-2 py-3 border-b border-[#F0EDE9] group"
                  >
                    <div
                      className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer"
                      onClick={() => handleViewDoc(doc)}
                    >
                      <FileText
                        size={12}
                        className="text-[#CBC7C0] shrink-0 mt-1"
                      />
                      <div className="min-w-0">
                        <p
                          className="text-[12px] text-[#4A4A4A] truncate"
                          title={doc.name}
                        >
                          {doc.name}
                        </p>
                        <p className="text-[10px] text-[#CBC7C0] mt-1">
                          {doc.category ? `${doc.category} / ` : ""}
                          {doc.chunks || 0} extraits ·{" "}
                          {formatNumber(doc.word_count || 0)} mots
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleViewDoc(doc)}
                        className="text-[#CBC7C0] hover:text-black transition-colors"
                        title="Lire"
                      >
                        <Eye size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-[#E5E2DD] hover:text-red-400 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      </div>
      {/* Document Reader Modal */}
      <AnimatePresence>
        {viewingDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-[#FDFCFA] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-[#E5E2DD] shrink-0">
              <div>
                <p className="text-[9px] tracking-[0.3em] font-semibold text-[#CBC7C0] uppercase mb-1">
                  Lecture
                </p>
                <h2 className="text-sm font-medium text-[#1A1A1A]">{viewingDoc.name}</h2>
              </div>
              <div className="flex items-center gap-4">
                {!editMode ? (
                  <button
                    onClick={handleEditDoc}
                    className="text-[#CBC7C0] hover:text-black transition-colors"
                    title="Modifier le document"
                  >
                    <Pencil size={14} />
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    {editError && (
                      <span className="text-[11px] text-red-400">{editError}</span>
                    )}
                    <button
                      onClick={handleCancelEdit}
                      className="text-[11px] tracking-widest text-[#8C8C8C] hover:text-black uppercase font-semibold"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={handleSaveDoc}
                      disabled={editSaving}
                      className="text-[11px] tracking-widest text-black uppercase font-bold disabled:opacity-30 flex items-center gap-1"
                    >
                      {editSaving ? <Loader2 size={12} className="animate-spin" /> : "Enregistrer"}
                    </button>
                  </div>
                )}
                <button
                  onClick={() => {
                    docAbortControllerRef.current?.abort();
                    setViewingDoc(null);
                    setDocContent("");
                    setDocMessages([]);
                    setDocLoading(false);
                    setEditMode(false);
                    setEditError("");
                  }}
                  className="text-[#CBC7C0] hover:text-black transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Tabs for mobile */}
            <div className="md:hidden flex border-b border-[#E5E2DD] bg-[#FDFCFA] shrink-0">
              <button
                type="button"
                onClick={() => setReaderTab("text")}
                className={`flex-1 py-3 text-[10px] tracking-widest uppercase font-bold transition-colors border-b-2 ${
                  readerTab === "text"
                    ? "border-black text-black"
                    : "border-transparent text-[#CBC7C0]"
                }`}
              >
                Texte
              </button>
              <button
                type="button"
                onClick={() => setReaderTab("chat")}
                className={`flex-1 py-3 text-[10px] tracking-widest uppercase font-bold transition-colors border-b-2 ${
                  readerTab === "chat"
                    ? "border-black text-black"
                    : "border-transparent text-[#CBC7C0]"
                }`}
              >
                Dialogue
              </button>
            </div>

            {/* Two-pane layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left: document text */}
              <div className={`flex-1 overflow-y-auto no-scrollbar px-6 md:px-12 py-6 md:py-12 border-r border-[#E5E2DD] ${
                readerTab === "text" ? "block" : "hidden md:block"
              }`}>
                {docContentLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={20} className="animate-spin text-[#8C8C8C]" />
                  </div>
                ) : editMode ? (
                  <div className="max-w-2xl mx-auto h-full flex flex-col">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="flex-1 w-full min-h-[60vh] text-[13px] font-light leading-relaxed text-[#1A1A1A] dark:text-[#ECEAE4] bg-transparent outline-none resize-none border border-[#E5E2DD] dark:border-[#2D2D29] rounded p-4"
                      placeholder="Contenu du document..."
                    />
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto">
                    {docChunks.length > 0 ? (
                      <div className="space-y-6">
                        {docChunks.map((chunkItem) => (
                          <p
                            key={chunkItem.chunk}
                            id={`doc-chunk-${chunkItem.chunk}`}
                            className="text-[15px] md:text-[13px] font-light leading-relaxed text-[#1A1A1A] dark:text-[#ECEAE4] whitespace-pre-wrap transition-all duration-300"
                          >
                            {chunkItem.content}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[15px] md:text-[13px] font-light leading-relaxed text-[#1A1A1A] dark:text-[#ECEAE4] whitespace-pre-wrap">
                        {docContent}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Right: inline AI conversation */}
              <div className={`w-full md:w-96 flex flex-col shrink-0 ${
                readerTab === "chat" ? "flex" : "hidden md:flex"
              }`}>
                <div className="px-5 py-4 border-b border-[#E5E2DD] shrink-0">
                  <p className="text-[9px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">
                    Dialogue
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-5 space-y-8">
                  {docMessages.length === 0 ? (
                    <p className="text-[11px] text-[#CBC7C0] italic mt-4">
                      Posez une question sur ce texte.
                    </p>
                  ) : (
                    docMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div className={`max-w-[90%] ${msg.role === "user" ? "text-right" : "text-left"}`}>
                          <p className="text-[9px] tracking-widest text-[#8C8C8C] uppercase font-semibold mb-2">
                            {msg.role === "user" ? "Vous" : "L'Esprit"}
                          </p>
                          <div className="text-[13px] leading-relaxed font-light text-[#1A1A1A] dark:text-[#ECEAE4]">
                            {msg.role === "user" ? (
                              <span>{msg.content}</span>
                            ) : (
                              <Markdown
                                components={{
                                  a: ({ href, children, ...props }) => {
                                    if (href && href.startsWith("#citation-")) {
                                      const parts = href.replace("#citation-", "").split("-");
                                      const docName = decodeURIComponent(parts[0]);
                                      const chunkIndex = parseInt(parts[1], 10);
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleCitationClick(docName, chunkIndex);
                                          }}
                                          className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded bg-[#F5F2EF] hover:bg-[#E5E2DD] text-[#4A4A4A] dark:bg-[#20201D] dark:hover:bg-[#2E2E2A] dark:text-[#ECEAE4] border border-[#E5E2DD] dark:border-[#2D2D29] text-[11px] font-semibold cursor-pointer transition-colors shadow-sm"
                                        >
                                          <BookOpen size={10} className="text-[#8C8C8C] shrink-0" />
                                          <span className="font-serif italic truncate max-w-28">{docName.split('.')[0]}</span>
                                          <span className="text-[9px] text-[#8C8C8C] dark:text-[#A6A196]">p. {chunkIndex}</span>
                                        </button>
                                      );
                                    }
                                    return (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="underline text-black dark:text-white font-medium hover:opacity-80"
                                        {...props}
                                      >
                                        {children}
                                      </a>
                                    );
                                  }
                                }}
                              >
                                {processCitations(msg.content)}
                              </Markdown>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={docScrollRef} />
                </div>

                <div className="px-5 py-4 border-t border-[#E5E2DD] shrink-0">
                  <form onSubmit={handleDocQuestion} className="flex items-center gap-3">
                    <input
                      type="text"
                      value={docInput}
                      onChange={(e) => setDocInput(e.target.value)}
                      placeholder="Question sur ce texte..."
                      disabled={docLoading}
                      className="flex-1 bg-transparent text-base md:text-[11px] font-light placeholder:italic placeholder:text-[#CBC7C0] outline-none disabled:opacity-30"
                    />
                    <button
                      type={docLoading ? "button" : "submit"}
                      onClick={docLoading ? handleDocStop : undefined}
                      disabled={!docLoading && !docInput.trim()}
                      className={`text-[10px] tracking-[0.18em] font-bold transition-colors disabled:opacity-20 uppercase whitespace-nowrap ${
                        docLoading ? "text-red-400 hover:text-red-500" : "text-[#8C8C8C] hover:text-black"
                      }`}
                    >
                      {docLoading ? "STOP" : "ENVOYER"}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
