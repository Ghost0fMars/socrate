/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, FileText, Trash2, UploadCloud, X } from "lucide-react";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import {
  sendMessageStream,
  uploadDocument,
  listDocuments,
  deleteDocument,
  type Document,
} from "./lib/api";

interface Message {
  id: string;
  role: "user" | "model";
  content: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [showDocs, setShowDocs] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
    } catch {
      // backend not yet reachable on first load
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError("");
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
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // ignore
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
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      let accumulated = "";
      const stream = sendMessageStream(inputValue, history);

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
            Interface_01
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
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col justify-center max-w-xl"
              >
                <h1 className="text-3xl md:text-5xl font-serif italic tracking-tight leading-tight mb-4">
                  Penser{" "}
                  <span className="font-sans not-italic text-sm uppercase tracking-[0.3em] align-middle ml-4 text-[#8C8C8C]">
                    v01
                  </span>
                </h1>
                <p className="text-lg md:text-xl font-light text-[#8C8C8C] max-w-md">
                  Partageons une pensée, explorons l'invisible.
                </p>
              </motion.div>
            ) : (
              messages.map((message) => (
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
              ))
            )}
          </AnimatePresence>
          <div ref={scrollRef} />
        </div>

        <div className="h-32 md:h-40 px-6 md:px-32 flex items-center border-t border-[#E5E2DD] bg-[#FDFCFA]">
          <form
            onSubmit={handleSubmit}
            className="w-full flex items-center justify-between group"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Écrivez ici..."
              disabled={isLoading}
              className="bg-transparent w-full text-lg md:text-2xl font-light placeholder:italic placeholder:text-[#CBC7C0] outline-none disabled:opacity-30"
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="ml-4 flex items-center gap-4 text-[11px] tracking-[0.2em] font-bold group-hover:text-black text-[#8C8C8C] transition-colors disabled:opacity-20 uppercase whitespace-nowrap"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                "ENVOYER"
              )}
              <div className="w-8 md:w-16 h-[1px] bg-current"></div>
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
                Documents
              </span>
              <button
                onClick={() => setShowDocs(false)}
                className="text-[#CBC7C0] hover:text-black transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Upload zone */}
            <div className="px-6 py-5 border-b border-[#E5E2DD]">
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
                  PDF · TXT · MD
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md"
                className="hidden"
                onChange={handleFileInput}
              />
              {uploadError && (
                <p className="mt-3 text-[11px] text-red-400">{uploadError}</p>
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
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText
                        size={12}
                        className="text-[#CBC7C0] shrink-0"
                      />
                      <span
                        className="text-[12px] text-[#4A4A4A] truncate"
                        title={doc.name}
                      >
                        {doc.name}
                      </span>
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
