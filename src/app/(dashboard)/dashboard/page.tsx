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
import { useUser } from "@clerk/nextjs";
import { startPracticeReplaySession, trackEvent } from "@/lib/analytics";

interface PastSession {
  id: string;
  context: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  notes_preview?: string | null;
  thread_attempts?: number;
}

interface PatternInsight {
  weakness: string;
  total_sessions: number;
}

interface SessionCapStatus {
  capSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  nextResetTime?: string;
  /** True when user is in SPAR_CAP_EXEMPT_USER_IDS */
  capExempt?: boolean;
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
  const { user, isLoaded: userLoaded } = useUser();
  const firstName = user?.firstName?.trim() || null;

  const router = useRouter();
  const searchParams = useSearchParams();
  const [contextText, setContextText] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessions, setSessions] = useState<PastSession[]>([]);
  const [pattern, setPattern] = useState<PatternInsight | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileAcceptedNote, setFileAcceptedNote] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [capStatus, setCapStatus] = useState<SessionCapStatus | null>(null);
  const [memorySnippet, setMemorySnippet] = useState<string | null>(null);
  const [knownPeople, setKnownPeople] = useState<string[]>([]);
  // const [phone, setPhone] = useState("");
  // const [phoneSaved, setPhoneSaved] = useState(false);
  // const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resumeHandledRef = useRef(false);

  useEffect(() => {
    const rid = searchParams?.get("resume");
    if (!rid || resumeHandledRef.current) return;
    resumeHandledRef.current = true;
    queueMicrotask(() => setLoading(true));
    fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeSessionId: rid, context: null }),
    })
      .then(async (res) => ({ res, data: await res.json().catch(() => ({})) }))
      .then(
        ({ res, data }: {
          res: Response;
          data: {
          sessionId?: string;
          systemPrompt?: string;
          firstMessage?: string;
          maxDurationSeconds?: number;
          cap?: SessionCapStatus;
          error?: string;
          message?: string;
        };
        }) => {
          if (res.ok && data.sessionId && data.systemPrompt) {
            startPracticeReplaySession({
              source: "dashboard_resume",
              session_id: data.sessionId,
            });
            sessionStorage.setItem(
              `spar_session_${data.sessionId}`,
              JSON.stringify({
                systemPrompt: data.systemPrompt,
                firstMessage: data.firstMessage,
                maxDurationSeconds: data.maxDurationSeconds,
                cap: data.cap,
              })
            );
            router.replace(`/session/${data.sessionId}`);
          } else {
            if (data.cap) setCapStatus(data.cap);
            setStartError(
              data.message ||
                data.error ||
                "Could not start another session right now."
            );
            setLoading(false);
            resumeHandledRef.current = false;
          }
        }
      )
      .catch(() => {
        setStartError("Could not start another session right now.");
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
        if (data.cap) setCapStatus(data.cap);
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
      queueMicrotask(() => setMemorySnippet(null));
      return;
    }
    let cancelled = false;
    fetch("/api/kabir/memory-snippet")
      .then((r) => r.json())
      .then((data: { snippet?: string | null; peopleNames?: string[] }) => {
        if (!cancelled) {
          setMemorySnippet(data.snippet ?? null);
          setKnownPeople(
            Array.isArray(data.peopleNames)
              ? data.peopleNames.filter((x) => typeof x === "string")
              : []
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMemorySnippet(null);
          setKnownPeople([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessions.length]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileError(null);
      setFileAcceptedNote(null);
      setFileProcessing(true);
      trackEvent("attachment_upload_started", {
        source: "dashboard",
        file_name: file.name,
        file_type: file.type || "unknown",
      });
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/process-attachment", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok) {
          trackEvent("attachment_upload_failed", {
            source: "dashboard",
            status: res.status,
            error: data?.error || "unknown",
          });
          setFileError(data?.error || "Could not process this file");
          return;
        }

        if (data.text) {
          trackEvent("attachment_upload_succeeded", {
            source: "dashboard",
            file_name: data.fileName || file.name,
          });
          setFileAcceptedNote(`Accepted: ${data.fileName || file.name}. Kabir will read this before the mic starts.`);
          setFiles((prev) => [
            ...prev,
            { name: data.fileName || file.name, text: data.text },
          ]);
        }
      } catch (err) {
        console.error("File processing failed:", err);
        trackEvent("attachment_upload_failed", {
          source: "dashboard",
          status: 0,
          error: "network_or_unknown",
        });
        setFileError("Upload failed. Please try again.");
      } finally {
        setFileProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileAcceptedNote(null);
  }, []);

  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, 3);

  async function startSession() {
    setLoading(true);
    setStartError(null);
    trackEvent("session_start_clicked", {
      source: "dashboard",
      has_context: Boolean(contextText.trim()),
      attached_files_count: files.length,
    });
    try {
      let merged = contextText.trim() || "";
      if (files.length > 0) {
        const fileContext = files
          .map((f) => `[Attached: ${f.name}]\n${f.text}`)
          .join("\n\n");
        merged = merged ? `${merged}\n\n${fileContext}` : fileContext;
      }

      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: merged || null,
          contextText: merged || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sessionId) {
        console.error("Session start failed:", data);
        trackEvent("session_start_failed", {
          source: "dashboard",
          status: res.status,
          error: data?.error || "unknown",
        });
        if (data?.cap) setCapStatus(data.cap);
        setStartError(
          data?.message ||
            data?.error ||
            "Could not start another session right now."
        );
        setLoading(false);
        return;
      }
      startPracticeReplaySession({
        source: "dashboard_start",
        session_id: data.sessionId,
      });
      trackEvent("session_start_succeeded", {
        source: "dashboard",
        session_id: data.sessionId,
      });
      sessionStorage.setItem(
        `spar_session_${data.sessionId}`,
        JSON.stringify({
          systemPrompt: data.systemPrompt,
          firstMessage: data.firstMessage,
          maxDurationSeconds: data.maxDurationSeconds,
          cap: data.cap,
          contextSummary: {
            contextChars: merged.length,
            files: files.map((f) => f.name),
          },
        })
      );
      router.push(`/session/${data.sessionId}`);
    } catch {
      trackEvent("session_start_failed", {
        source: "dashboard",
        status: 0,
        error: "network_or_unknown",
      });
      setStartError("Could not start another session right now.");
      setLoading(false);
    }
  }

  return (
    <div className="text-[#E2E8F0]">
      {/* TOP */}
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <div className="text-center">
          {!loading && (
            <p className="mb-4 text-[12px] font-medium uppercase tracking-[0.18em] text-cyan-300/85">
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
            <details className="mx-auto mt-6 w-full max-w-xl text-left [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-400 transition-colors hover:text-slate-200">
                <span className="inline-flex items-center gap-2">
                  Add context for Kabir
                  <span className="text-[10px] text-slate-600">▼</span>
                </span>
              </summary>
              <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-4">
                <label htmlFor="kabir-context-paste" className="sr-only">
                  Context for Kabir
                </label>
                <textarea
                  id="kabir-context-paste"
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                  placeholder="Paste an email, message, job description, or anything Kabir should read before your session."
                  rows={6}
                  className="w-full rounded-lg border border-slate-700/55 bg-slate-900/55 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/60"
                />
                <p className="text-xs leading-relaxed text-slate-500">
                  Kabir will read this before your conversation starts.
                </p>
                {contextText.trim() || files.length > 0 ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Context ready for Kabir: {contextText.trim().length} typed chars and {files.length} file{files.length === 1 ? "" : "s"}.
                    This context will be loaded before you start speaking.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                    Optional: add typed notes or files, then start session.
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                {files.length > 0 && (
                  <div className="space-y-1.5">
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

                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileProcessing}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-600/55 bg-slate-900/40 px-5 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/35 hover:bg-slate-800/50 disabled:opacity-50"
                  >
                    {fileProcessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Paperclip className="h-3.5 w-3.5" />
                    )}
                    {fileProcessing ? "Processing…" : "Add file to context"}
                  </button>
                </div>

                {fileError ? (
                  <p className="text-xs text-red-400">{fileError}</p>
                ) : null}
                {fileAcceptedNote ? (
                  <p className="text-xs text-emerald-300">{fileAcceptedNote}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => void startSession()}
                  disabled={loading}
                  className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
                >
                  Start session with this context
                </button>
              </div>
            </details>
          )}

          {!loading && memorySnippet ? (
            <p className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-2 px-2 text-center text-xs leading-relaxed text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              <span>Kabir remembers your last session.</span>
            </p>
          ) : null}
          {!loading && knownPeople.length > 0 ? (
            <p className="mx-auto mt-1 max-w-lg px-2 text-center text-[11px] text-slate-500">
              Kabir knows about: {knownPeople.join(", ")}
            </p>
          ) : null}

          {capStatus ? (
            <p className="mx-auto mt-5 max-w-lg text-center text-sm text-cyan-300/80">
              {capStatus.capExempt ? (
                <>Practice cap: unlimited (owner)</>
              ) : (
                <>
                  Free launch practice left:{" "}
                  {Math.floor(capStatus.remainingSeconds / 60)} min{" "}
                  {String(capStatus.remainingSeconds % 60).padStart(2, "0")} sec
                </>
              )}
            </p>
          ) : null}

          {startError ? (
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-amber-300/90">
              {startError}
            </p>
          ) : null}

          {!loading && userLoaded ? (
            <p className="mx-auto mt-8 max-w-2xl px-2 text-center text-[1.35rem] font-semibold leading-snug tracking-tight text-cyan-50/95 sm:text-2xl">
              {firstName
                ? `Hi, ${firstName}`
                : "Hi there"}
            </p>
          ) : null}

          <h1
            className={`text-4xl font-bold tracking-tight leading-tight ${!loading && userLoaded ? "mt-3" : "mt-8"}`}
          >
            {loading
              ? "Connecting to Kabir..."
              : "What conversation are you looking forward to?"}
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-300">
            Kabir is an AI coach. Practice first, then walk in ready.
          </p>
        </div>
      </div>

      {/* MIDDLE — sessions or first-time */}
      <div className="mt-8 border-t border-slate-800/70 pt-14">
        {sessions.length > 0 ? (
          <>
            <h2 className="mb-7 text-sm font-semibold uppercase tracking-widest text-slate-300">
              Your conversation threads
            </h2>
            <div className="space-y-4">
              {visibleSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/notes/${session.id}`}
                  className="block rounded-lg border border-slate-600/50 bg-[#0b1d3e]/55 px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors hover:border-cyan-500/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                          {relativeSessionTime(session.ended_at)}
                        </p>
                        {(session.thread_attempts || 1) > 1 ? (
                          <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-200">
                            {session.thread_attempts} attempts
                          </span>
                        ) : null}
                      </div>
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
