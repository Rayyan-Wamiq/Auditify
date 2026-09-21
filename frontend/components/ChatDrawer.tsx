"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  FileText,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sendChatMessage, ApiError } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

interface Props {
  activeModel: string;
  selectedRunId: string | null;
}

interface QuickAction {
  icon: typeof Search;
  label: string;
  prompt: string;
}

// Modern quick-action chips shown in the empty state. `label` is what the user
// sees; `prompt` is the richer instruction actually sent to the copilot.
const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: Search,
    label: "Analyze top compliance risks",
    prompt: "Analyze the top compliance risks in this audit and explain them briefly.",
  },
  {
    icon: ShieldCheck,
    label: "How to fix critical security issues?",
    prompt: "How do I fix the critical security issues found in this audit?",
  },
  {
    icon: FileText,
    label: "Summarize latest audit findings",
    prompt: "Summarize the latest audit findings.",
  },
];

// Incrementally reveals assistant message content (typewriter effect). The
// chat API returns the full answer in one response, so streaming is simulated
// client-side: characters are sliced into view on a fast interval. Only the
// newest assistant message animates (via `animate`); older messages and error
// notices render instantly so history stays stable and readable.
function TypewriterText({
  content,
  animate,
  onGrow,
  onDone,
}: {
  content: string;
  animate: boolean;
  onGrow?: () => void;
  onDone?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : content.length);

  useEffect(() => {
    if (!animate) {
      setVisibleCount(content.length);
      return;
    }
    setVisibleCount(0);
    // ~60fps ticks; step scales with length so even long answers finish in
    // a couple of seconds instead of crawling.
    const step = Math.max(3, Math.ceil(content.length / 160));
    const timer = window.setInterval(() => {
      setVisibleCount((prev) => {
        const next = prev + step;
        if (next >= content.length) {
          window.clearInterval(timer);
          return content.length;
        }
        return next;
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [content, animate]);

  // Keep the drawer pinned to the latest revealed characters while typing,
  // and notify the parent once the reveal finishes (clears `typingIndex`).
  useEffect(() => {
    if (!animate) return;
    if (visibleCount < content.length) {
      onGrow?.();
    } else {
      onDone?.();
    }
  }, [visibleCount, animate, content.length, onGrow, onDone]);

  const isTyping = animate && visibleCount < content.length;

  return (
    <div className="copilot-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.slice(0, visibleCount)}</ReactMarkdown>
      {isTyping && (
        <span
          className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded-sm bg-emerald-500 align-middle"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default function ChatDrawer({ activeModel, selectedRunId }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Index of the assistant message currently playing its typewriter reveal.
  // `null` once the animation completes so re-renders never re-animate.
  const [typingIndex, setTypingIndex] = useState<number | null>(null);

  // Stable scroll-to-bottom used by both the message-list effect and the
  // typewriter's onGrow callback (stable identity avoids re-triggering the
  // effect on every parent render).
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleTypingDone = useCallback(() => setTypingIndex(null), []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, open, scrollToBottom]);

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await sendChatMessage(content, selectedRunId, activeModel, nextMessages);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
      // Play the typewriter reveal for this (newest) assistant message.
      setTypingIndex(nextMessages.length);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "The copilot is unreachable right now. Check your connection and try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: message, isError: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Auditify AI Assistant"
        className={`fixed bottom-6 right-6 z-30 flex h-16 w-16 items-center justify-center rounded-full ${
          open ? "hidden" : "flex"
        }`}
      >
        {/* Soft green halo layers */}
        <span className="absolute inset-0 rounded-full bg-emerald-400/25 blur-xl scale-150" />
        <span className="absolute inset-0 rounded-full bg-emerald-300/40 blur-md scale-110" />
        {/* Sparkle trail (shine particles flying out) */}
        <span className="fab-sparkle left-[-26px] top-[14px] h-1.5 w-1.5" style={{ animationDelay: "0s" }} />
        <span className="fab-sparkle left-[-38px] top-[30px] h-1 w-1" style={{ animationDelay: "0.5s" }} />
        <span className="fab-sparkle left-[-18px] top-[42px] h-1 w-1" style={{ animationDelay: "1s" }} />
        <span className="fab-sparkle left-[-32px] top-[54px] h-1.5 w-1.5" style={{ animationDelay: "1.4s" }} />
        <span className="fab-sparkle left-[-12px] top-[6px] h-1 w-1" style={{ animationDelay: "0.8s" }} />
        <span className="fab-sparkle left-[-24px] top-[62px] h-1 w-1" style={{ animationDelay: "1.8s" }} />
        {/* Gradient ring */}
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-300 via-emerald-400 to-teal-500" />
        {/* Main button core */}
        <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 shadow-[0_0_30px_rgba(16,185,129,0.5)]">
          {/* Glowing robot face */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-10 w-10 drop-shadow-[0_0_6px_rgba(94,234,212,0.9)]"
            aria-hidden="true"
          >
            {/* Antenna */}
            <line x1="12" y1="2.5" x2="12" y2="5" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="2" r="1.2" fill="#a7f3d0" />
            {/* Head */}
            <rect x="5.5" y="5" width="13" height="11.5" rx="3" stroke="#6ee7b7" strokeWidth="1.6" />
            {/* Ears */}
            <line x1="3.2" y1="9" x2="3.2" y2="12.5" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="20.8" y1="9" x2="20.8" y2="12.5" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
            {/* Glowing eyes */}
            <circle cx="9.3" cy="10" r="1.5" fill="#5eead4" />
            <circle cx="14.7" cy="10" r="1.5" fill="#5eead4" />
            {/* Mouth */}
            <line x1="10" y1="13.8" x2="14" y2="13.8" stroke="#6ee7b7" strokeWidth="1.5" strokeLinecap="round" />
            {/* Chin */}
            <path d="M9.5 16.5v1.2a2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5v-1.2" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20 animate-fade-in sm:bg-transparent sm:pointer-events-none">
          <div className="pointer-events-auto flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl animate-slide-in">
            {/* Header: dark gradient bar with a live connection status badge */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 p-4 text-white">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/30">
                  <Bot size={17} className="text-emerald-400" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight">
                    Auditify AI Assistant
                  </p>
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300/90">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    Online &bull; Context Connected
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className="hidden rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-300 sm:inline"
                  title={
                    selectedRunId
                      ? "Answers are grounded in the selected audit run"
                      : "Answers are grounded in all uploaded specs"
                  }
                >
                  {selectedRunId ? "Scoped: selected run" : "Scoped: all specs"}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-all duration-200 hover:bg-red-500 hover:text-white hover:shadow-sm"
                  aria-label="Close copilot"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center px-1 text-center">
                  {/* Glowing sparkles badge */}
                  <div className="relative mb-4">
                    <span
                      className="absolute inset-0 rounded-2xl bg-emerald-400/30 blur-xl"
                      aria-hidden="true"
                    />
                    <Sparkles
                      className="relative h-12 w-12 rounded-2xl bg-emerald-500/10 p-2 text-emerald-400"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>

                  <h2 className="text-base font-semibold tracking-tight text-slate-900">
                    How can I assist with your audit today?
                  </h2>
                  <p className="mt-1.5 max-w-[280px] text-xs leading-relaxed text-slate-500">
                    Ask questions about security findings, compliance scores, or remediation
                    steps.
                  </p>

                  {/* Modern quick-action chips */}
                  <div className="mt-5 w-full space-y-2">
                    {QUICK_ACTIONS.map(({ icon: Icon, label, prompt }) => (
                      <button
                        key={label}
                        onClick={() => handleSend(prompt)}
                        className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 shadow-sm transition-all hover:border-emerald-500 hover:bg-emerald-50/50 dark:border-slate-800 dark:hover:bg-emerald-950/20"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/15">
                          <Icon size={15} />
                        </span>
                        <span className="flex-1 font-medium">{label}</span>
                        <ArrowUpRight
                          size={14}
                          className="shrink-0 text-slate-300 transition-colors group-hover:text-emerald-500"
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm ${
                      m.role === "user"
                        ? "bg-slate-900 text-white"
                        : m.isError
                        ? "border border-red-200 bg-red-50 text-red-700"
                        : "border border-slate-200 bg-slate-50 text-slate-800"
                    }`}
                  >
                    {m.role === "assistant" && m.isError && (
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                        <AlertCircle size={12} /> Copilot error
                      </div>
                    )}
                    {m.role === "assistant" ? (
                      m.isError ? (
                        <div className="copilot-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <TypewriterText
                          content={m.content}
                          animate={typingIndex === i}
                          onGrow={scrollToBottom}
                          onDone={handleTypingDone}
                        />
                      )
                    ) : (
                      <p className="leading-relaxed">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500">
                    <Loader2 size={14} className="animate-spin text-emerald-600" />
                    Analyzing audit context&hellip;
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Ask the Auditify AI Assistant…"
                  className="max-h-28 flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200"
                  aria-label="Send message"
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
