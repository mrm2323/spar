"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mic,
  Loader2,
  ArrowRight,
  Paperclip,
  X,
} from "lucide-react";
import Link from "next/link";

interface PastSession {
  id: string;
  context: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  notes_preview?: string | null;
  confidence?: number | null;
}

interface PatternInsight {
  weakness: string;
  total_sessions: number;
}

function relativeSessionTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface ProcessedFile {
  name: string;
  text: string;
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessions, setSessions] = useState<PastSession[]>([]);
  const [pattern, setPattern] = useState<PatternInsight | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [memorySnippet, setMemorySnippet] = useState<string | null>(null);
  // const [phone, setPhone] = useState("");
  // const [phoneSaved, setPhoneSaved] = useState(false);
  // const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resumeHandledRef = useRef(false);

  useEffect(() => {
    const rid = searchParams?.get("resume");
    if (!rid || resumeHandledRef.current) return;
    resumeHandledRef.current = true;
    setLoading(true);
    fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeSessionId: rid, context: null }),
    })
      .then((res) => res.json())
      .then(
        (data: {
          sessionId?: string;
          systemPrompt?: string;
          firstMessage?: string;
        }) => {
          if (data.sessionId && data.systemPrompt) {
            sessionStorage.setItem(
              `spar_session_${data.sessionId}`,
              JSON.stringify({
                systemPrompt: data.systemPrompt,
                firstMessage: data.firstMessage,
              })
            );
            router.replace(`/session/${data.sessionId}`);
          } else {
            setLoading(false);
            resumeHandledRef.current = false;
          }
        }
      )
      .catch(() => {
        setLoading(false);
        resumeHandledRef.current = false;
      });
  }, [searchParams, router]);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions);
        if (data.pattern) setPattern(data.pattern);
      })
      .catch(() => {});

    // fetch("/api/user/phone")
    //   .then((r) => r.json())
    //   .then((data) => {
    //     if (data.phone) setLinkedPhone(data.phone);
    //   })
    //   .catch(() => {});
  }, []);

  useEffect(() => {
    if (sessions.length === 0) {
      setMemorySnippet(null);
      return;
    }
    let cancelled = false;
    fetch("/api/kabir/memory-snippet")
      .then((r) => r.json())
      .then((data: { snippet?: string | null }) => {
        if (!cancelled) setMemorySnippet(data.snippet ?? null);
      })
      .catch(() => {
        if (!cancelled) setMemorySnippet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessions.length]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileProcessing(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/process-attachment", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.text) {
          setFiles((prev) => [
            ...prev,
            { name: data.fileName || file.name, text: data.text },
          ]);
        }
      } catch (err) {
        console.error("File processing failed:", err);
      }
      setFileProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, 3);

  async function startSession() {
    setLoading(true);
    try {
      let fullContext = context.trim() || "";
      if (files.length > 0) {
        const fileContext = files
          .map((f) => `[Attached: ${f.name}]\n${f.text}`)
          .join("\n\n");
        fullContext = fullContext
          ? `${fullContext}\n\n${fileContext}`
          : fileContext;
      }

      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: fullContext || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.sessionId) {
        console.error("Session start failed:", data);
        setLoading(false);
        return;
      }
      sessionStorage.setItem(
        `spar_session_${data.sessionId}`,
        JSON.stringify({
          systemPrompt: data.systemPrompt,
          firstMessage: data.firstMessage,
        })
      );
      router.push(`/session/${data.sessionId}`);
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="text-[#E2E8F0]">
      {/* TOP */}
      <div className="flex min-h-[52vh] flex-col items-center justify-center">
        <div className="text-center">
          {!loading && (
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300/85">
              Tap mic to start
            </p>
          )}

          <button
            type="button"
            onClick={startSession}
            disabled={loading}
            aria-label="Start conversation with Kabir"
            className="group relative mx-auto mb-6 flex h-44 w-44 cursor-pointer items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/5 transition-all duration-300 hover:scale-[1.01] hover:border-cyan-300/60 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/25 to-blue-500/15 blur-2xl" />
            <span className="pointer-events-none absolute inset-3 rounded-full border border-cyan-200/15" />
            <span className="pointer-events-none absolute inset-0 rounded-full animate-pulse-ring border border-cyan-300/30" />
            {loading ? (
              <Loader2 className="relative z-10 h-10 w-10 animate-spin text-cyan-200" />
            ) : (
              <div className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-[0_0_28px_rgba(56,189,248,0.45)] transition-transform duration-300 group-hover:scale-[1.03]">
                <Mic className="h-9 w-9" />
              </div>
            )}
          </button>

          {!loading && (
            <p className="mx-auto mt-4 max-w-lg px-2 text-center text-xs leading-relaxed text-slate-500">
              {sessions.length === 0
                ? "First time? Kabir is listening."
                : memorySnippet
                  ? `Kabir remembers: ${memorySnippet}`
                  : "Kabir is building your history as you practice."}
            </p>
          )}

          <h1 className="text-2xl font-semibold tracking-tight">
            {loading
              ? "Connecting to Kabir..."
              : "What conversation are you looking forward to?"}
          </h1>

          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
            Kabir is an AI coach. Practice first, then walk in ready.
          </p>

          {!loading && (
            <div className="mt-6">
              {!showContext ? (
                <button
                  type="button"
                  onClick={() => setShowContext(true)}
                  className="text-sm text-slate-400 hover:text-slate-200"
                >
                  Add context for Kabir
                </button>
              ) : (
                <div className="mx-auto max-w-sm animate-fade-in">
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. I need to tell my roommate I'm moving out..."
                    rows={2}
                    autoFocus
                    className="w-full rounded-lg border border-slate-700/55 bg-slate-900/55 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/60"
                  />

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.txt,.md,.csv,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {files.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {files.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/25 px-3 py-1.5 text-xs text-slate-300"
                        >
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="ml-auto shrink-0 text-slate-500 hover:text-slate-300"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileProcessing}
                    className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50"
                  >
                    {fileProcessing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Paperclip className="h-3 w-3" />
                    )}
                    {fileProcessing ? "Processing..." : "Attach a file"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MIDDLE — sessions or first-time */}
      <div className="mt-4 border-t border-slate-800/70 pt-10">
        {sessions.length > 0 ? (
          <>
            <h2 className="mb-5 text-xs font-medium uppercase tracking-widest text-slate-400">
              Your sessions with Kabir
            </h2>
            <div className="space-y-3">
              {visibleSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/notes/${session.id}`}
                  className="block rounded-lg border border-slate-600/50 bg-[#0b1d3e]/55 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:border-cyan-500/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        {relativeSessionTime(session.ended_at)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-100">
                        {session.notes_preview ||
                          session.context ||
                          "Session"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
                  </div>
                </Link>
              ))}
            </div>

            {sessions.length > 3 && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllSessions((v) => !v)}
                  className="rounded-full border border-slate-600/60 bg-slate-900/35 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-300 transition-colors hover:border-cyan-500/60 hover:text-white"
                >
                  {showAllSessions ? "Show less" : "Read more"}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-sm leading-relaxed text-slate-400">
            First time? Tell Kabir what&apos;s coming up. He&apos;s heard it all.
          </p>
        )}
      </div>

      {/* Pattern — 3+ sessions */}
      {pattern && pattern.total_sessions >= 3 && (
        <div className="mt-10 border-t border-slate-800/70 pt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-400">
            Kabir&apos;s pattern
          </h2>
          <div className="rounded-lg border border-slate-600/50 bg-[#0b1d3e]/55 px-4 py-4 text-sm leading-relaxed text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            Across {pattern.total_sessions} sessions, Kabir noticed you tend to{" "}
            {pattern.weakness}. Keep practicing — this usually improves fast.
          </div>
        </div>
      )}

      {/*
      Phone section intentionally commented out. Keep this code to restore quickly.
      <div className="mt-10 border-t border-slate-800/70 pt-8">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-500">
          <Phone className="h-3 w-3" />
          Call Kabir by phone
        </div>
        {linkedPhone ? (
          <p className="mt-3 text-sm text-slate-400">
            Your phone{" "}
            <span className="text-slate-200">{linkedPhone}</span> is linked.
            Phone sessions appear in your list above.
          </p>
        ) : (
          <div className="mt-3">
            <p className="mb-3 text-sm text-slate-400">
              Link your number so phone calls show up here with notes.
            </p>
            <div className="flex max-w-xs items-center gap-2">
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setPhoneSaved(false);
                }}
                placeholder="+1 (555) 123-4567"
                className="flex-1 rounded-lg border border-slate-700/55 bg-slate-900/55 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/60"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!phone.trim()) return;
                  const res = await fetch("/api/user/phone", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ phone }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    setLinkedPhone(data.phone);
                    setPhoneSaved(true);
                    fetch("/api/sessions")
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.sessions) setSessions(d.sessions);
                        if (d.pattern) setPattern(d.pattern);
                      })
                      .catch(() => {});
                  }
                }}
                disabled={phoneSaved}
                className="rounded-lg border border-slate-600/70 px-3 py-2 text-sm text-slate-300 hover:border-cyan-500/60 hover:text-white disabled:opacity-50"
              >
                {phoneSaved ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  "Link"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
      */}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
          Loading…
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
