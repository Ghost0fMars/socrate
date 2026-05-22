/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { BookOpen, Loader2, FileText, Trash2, UploadCloud, X } from "lucide-react";
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
  type Document,
  type CorpusStats,
  type ModelInfo,
} from "./lib/api";

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
}

const MODEL_LABELS: Record<string, string> = {
  "qwen3:14b": "Reflexion",
  "gemma3:12b": "Fiction",
};

const getModelLabel = (name: string) => MODEL_LABELS[name] ?? name;

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const indexPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const formatNumber = (value: number) =>
    new Intl.NumberFormat("fr-FR").format(value);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (indexPollRef.current) clearInterval(indexPollRef.current);
    };
  }, []);

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
    loadDocuments();
  }, [loadDocuments]);

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
    loadModels();
  }, [loadModels]);

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

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
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
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: "error",
          role: "model",
          content:
            "Une erreur est survenue. Vérifiez que le serveur local est démarré.",
        },
      ]);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#FDFCFA] text-[#1A1A1A] overflow-hidden">
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
          {/* Document toggle */}
          <button
            onClick={() => setShowDocs((v) => !v)}
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

          <div className="w-1.5 h-1.5 rounded-full bg-[#E5E2DD]"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-black"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-[#E5E2DD]"></div>
        </div>
      </nav>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col relative h-full min-w-0">

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-32 py-16 space-y-24 scroll-smooth">
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex w-full ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-2xl w-full ${message.role === "user" ? "text-right ml-auto" : "text-left mr-auto"}`}
                >
                  <p className="text-[10px] tracking-widest text-[#8C8C8C] mb-4 uppercase font-semibold">
                    {message.role === "user" ? "Vous" : "L'Esprit"}
                  </p>
                  <div
                    className={`markdown-body ${message.role === "user" ? "text-2xl font-light leading-snug" : "text-lg leading-relaxed font-light"}`}
                  >
                    {message.role === "user" ? (
                      <span className="font-light">{message.content}</span>
                    ) : (
                      <Markdown>{message.content}</Markdown>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={scrollRef} />
        </div>

        <div className="h-24 md:h-28 px-6 md:px-24 flex items-center border-t border-[#E5E2DD] bg-[#FDFCFA]">
          <form
            onSubmit={handleSubmit}
            className="w-full flex items-center gap-4 group"
          >
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
              className="h-8 max-w-40 shrink-0 border border-[#E5E2DD] bg-transparent px-2 text-[10px] tracking-widest uppercase text-[#8C8C8C] outline-none transition-colors hover:border-[#CBC7C0] disabled:opacity-30"
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
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder=""
              disabled={isLoading}
              className="bg-transparent min-w-0 flex-1 text-[11px] font-light placeholder:italic placeholder:text-[#CBC7C0] outline-none disabled:opacity-30"
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
            className="border-l border-[#E5E2DD] flex flex-col overflow-hidden shrink-0 bg-[#FDFCFA]"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-6 border-b border-[#E5E2DD]">
              <span className="text-[10px] tracking-[0.3em] font-semibold text-[#8C8C8C] uppercase">
                Corpus
              </span>
              <button
                onClick={() => setShowDocs(false)}
                className="text-[#CBC7C0] hover:text-black transition-colors"
              >
                <X size={14} />
              </button>
            </div>

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
                    <div className="flex items-start gap-2 min-w-0">
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
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="text-[#E5E2DD] hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                      title="Supprimer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
