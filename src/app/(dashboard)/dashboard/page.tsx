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
import { UnderstandingMap } from "@/components/UnderstandingMap";
import { CONTEXT_SITUATION_PRESETS } from "@/lib/context-presets";

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

function dashboardGreeting(
  firstName: string | null,
  memorySnippet: string | null
): string {
  const name = firstName?.trim() || "there";
  const sn = memorySnippet?.toLowerCase() ?? "";
  if (
    /\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/.test(
      sn
    )
  ) {
    return `sounds like something's coming up soon, ${name}. want to run through it?`;
  }
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return `morning, ${name}. what's on your mind today?`;
  if (h >= 12 && h < 17) return `hey ${name}. anything coming up?`;
  if (h >= 17 && h < 22) return `hey ${name}. anything coming up?`;
  return `late night, ${name}? what conversation are you looking forward to?`;
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
  /** Chosen preset — sent as `situationPreset`; not injected as bracket text in the textarea. */
  const [selectedSituation, setSelectedSituation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessions, setSessions] = useState<PastSession[]>([]);
  /** From user_memory.total_sessions — avoids “first time?” while history list is still syncing */
  const [practiceSessionCount, setPracticeSessionCount] = useState(0);
  const [pattern, setPattern] = useState<PatternInsight | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileAcceptedNote, setFileAcceptedNote] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [capStatus, setCapStatus] = useState<SessionCapStatus | null>(null);
  const [memorySnippet, setMemorySnippet] = useState<string | null>(null);
  const [knownPeople, setKnownPeople] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<Array<{ name: string; sessionCount: number }>>([]);
  const [people, setPeople] = useState<Array<{ relationship?: string }>>([]);
  const [goalEntries, setGoalEntries] = useState<Array<{ metadata?: { kabirNoticedAt?: string } }>>([]);
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
            "something broke. try again?"
        );
            setLoading(false);
            resumeHandledRef.current = false;
          }
        }
      )
      .catch(() => {
        setStartError("something broke. try again?");
        setLoading(false);
        resumeHandledRef.current = false;
      });
  }, [searchParams, router]);

  useEffect(() => {
    Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/memory/profile").then((r) => r.json().catch(() => ({}))),
      fetch("/api/memory/people").then((r) => r.json().catch(() => ({}))),
      fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", limit: 60 }),
      }).then((r) => r.json().catch(() => ({}))),
    ])
      .then(([sessionsData, profileData, peopleData, memoryData]) => {
        if (sessionsData.sessions) setSessions(sessionsData.sessions);
        if (typeof sessionsData.practiceSessionCount === "number") {
          setPracticeSessionCount(sessionsData.practiceSessionCount);
        }
        if (sessionsData.pattern) setPattern(sessionsData.pattern);
        if (sessionsData.cap) setCapStatus(sessionsData.cap);
        if (Array.isArray(profileData.patterns)) setPatterns(profileData.patterns);
        if (Array.isArray(peopleData.people)) setPeople(peopleData.people);
        const goals = (memoryData.memories || []).filter(
          (e: any) => e.metadata?.category === "goals"
        );
        if (Array.isArray(goals)) setGoalEntries(goals);
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
  const greetingLine = dashboardGreeting(firstName, memorySnippet);

  async function startSession() {
    setLoading(true);
    setStartError(null);
    trackEvent("session_start_clicked", {
      source: "dashboard",
      has_context: Boolean(contextText.trim()),
      has_situation_preset: Boolean(selectedSituation),
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
          situationPreset: selectedSituation || undefined,
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
            "something broke. try again?"
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
      setSelectedSituation(null);
      router.push(`/session/${data.sessionId}`);
    } catch {
      trackEvent("session_start_failed", {
        source: "dashboard",
        status: 0,
        error: "network_or_unknown",
      });
      setStartError("something broke. try again?");
      setLoading(false);
    }
  }

  return (
    <div className="text-[#F1F5F9]">
      {/* TOP — greeting, mic, context */}
      <div className="flex min-h-[65vh] flex-col items-center justify-center px-2">
        <div className="w-full max-w-xl text-center">
          {!loading && userLoaded ? (
            <p className="text-lg font-medium leading-snug tracking-tight text-[#F8FAFC] sm:text-xl">
              {greetingLine}
            </p>
          ) : null}

          <button
            type="button"
            onClick={startSession}
            disabled={loading}
            aria-label="talk to kabir"
            aria-busy={loading}
            className="group relative mx-auto mt-10 flex h-52 w-52 cursor-pointer items-center justify-center rounded-full border border-cyan-500/35 bg-cyan-500/[0.07] transition-all duration-300 hover:scale-[1.01] hover:border-violet-400/40 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0F] disabled:cursor-not-allowed disabled:opacity-50 sm:h-56 sm:w-56"
          >
            <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-cyan-400/22 to-violet-600/12 blur-3xl" />
            <span className="pointer-events-none absolute inset-4 rounded-full border border-cyan-200/10" />
            <span className="pointer-events-none absolute inset-0 rounded-full animate-pulse-slow border border-violet-400/25" />
            {loading ? (
              <Loader2 className="relative z-10 h-11 w-11 animate-spin text-cyan-200" />
            ) : (
              <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-[#0A0A0F] shadow-[0_0_38px_rgba(56,189,248,0.38)] transition-transform duration-300 group-hover:scale-[1.04] sm:h-[5.5rem] sm:w-[5.5rem]">
                <Mic className="h-10 w-10 sm:h-11 sm:w-11" />
              </div>
            )}
          </button>

          <p className="mx-auto mt-5 max-w-xs text-sm" style={{ color: "#94A3B8" }}>
            {loading ? "starting…" : "tap to talk to kabir"}
          </p>

          {!loading && (
            <details className="mx-auto mt-6 w-full max-w-xl text-left [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none text-sm font-medium text-[#94A3B8] transition-colors hover:text-[#F1F5F9]">
                <span className="inline-flex items-center gap-2">
                  add what kabir should read first
                  <span className="text-[10px] text-slate-600">▼</span>
                </span>
              </summary>
              <div className="mt-4 space-y-3 border-t border-slate-800/80 pt-4">
                <p className="text-xs font-medium text-[#94A3B8]">
                  quick situation (optional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {CONTEXT_SITUATION_PRESETS.map((preset) => {
                    const on = selectedSituation === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setSelectedSituation((prev) =>
                            prev === preset ? null : preset
                          )
                        }
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                          on
                            ? "border-cyan-400/55 bg-cyan-500/20 text-cyan-50 ring-1 ring-cyan-400/35"
                            : "border-cyan-500/25 bg-cyan-500/10 text-cyan-100/90 hover:border-violet-400/35 hover:bg-violet-500/10"
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>
                {selectedSituation ? (
                  <p className="text-[11px] text-cyan-200/80">
                    kabir will open expecting:{" "}
                    <span className="font-medium text-cyan-100">{selectedSituation}</span>
                    {" — "}
                    tap again to clear
                  </p>
                ) : null}
                <label htmlFor="kabir-context-paste" className="sr-only">
                  Context for Kabir
                </label>
                <textarea
                  id="kabir-context-paste"
                  value={contextText}
                  onChange={(e) => setContextText(e.target.value)}
                  placeholder="Add context — paste an email, message, job description, or anything else Kabir should read first."
                  rows={6}
                  className="w-full rounded-xl border border-white/[0.08] bg-[#12121a] px-4 py-3 text-sm text-[#F1F5F9] placeholder-[#64748B] outline-none focus:border-cyan-500/40"
                />
                <p className="text-xs leading-relaxed text-slate-500">
                  Kabir will read this before your conversation starts.
                </p>
                {contextText.trim() || files.length > 0 || selectedSituation ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {selectedSituation ? (
                      <span className="block text-emerald-100/95">
                        Focus: {selectedSituation}
                      </span>
                    ) : null}
                    Context ready for Kabir: {contextText.trim().length} typed chars and {files.length} file{files.length === 1 ? "" : "s"}.
                    This loads before you start speaking.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                    Optional: pick a situation, add notes or files, then start.
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
                  className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 py-3 text-sm font-semibold text-[#0A0A0F] transition-opacity hover:opacity-95 disabled:opacity-50"
                >
                  talk to kabir with this context
                </button>
              </div>
            </details>
          )}

          {!loading && memorySnippet ? (
            <p className="mx-auto mt-4 flex max-w-lg items-center justify-center gap-2 px-2 text-center text-xs leading-relaxed text-[#94A3B8]">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/80" aria-hidden />
              <span>kabir remembers your last session.</span>
            </p>
          ) : null}
          {!loading && knownPeople.length > 0 ? (
            <p className="mx-auto mt-1 max-w-lg px-2 text-center text-[11px] text-[#64748B]">
              kabir knows about: {knownPeople.join(", ")}
            </p>
          ) : null}

          {capStatus ? (
            <p className="mx-auto mt-5 max-w-lg text-center text-sm text-cyan-200/85">
              {capStatus.capExempt ? (
                <>unlimited practice</>
              ) : (
                <>
                  free practice left:{" "}
                  {Math.floor(capStatus.remainingSeconds / 60)} min{" "}
                  {String(capStatus.remainingSeconds % 60).padStart(2, "0")} sec
                </>
              )}
            </p>
          ) : null}

          {startError ? (
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-violet-300/90">
              {startError}
            </p>
          ) : null}

          <p
            className={`mx-auto mt-8 max-w-xl text-base leading-relaxed text-[#94A3B8] ${!loading && userLoaded ? "" : "mt-10"}`}
          >
            {loading
              ? "kabir's thinking…"
              : "what conversation are you rehearsing?"}
          </p>
        </div>
      </div>

      {/* MIDDLE — sessions or first-time */}
      <div className="mt-10 border-t border-white/[0.06] pt-14">
        {sessions.length > 0 ? (
          <>
            {sessions.length >= 3 && (pattern || memorySnippet) ? (
              <Link
                href="/dashboard/memory"
                className="mb-8 block rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] px-5 py-4 text-left transition-colors hover:border-violet-400/35"
              >
                <p className="text-[11px] font-medium uppercase tracking-wider text-cyan-400/90">
                  kabir has noticed
                </p>
                <p className="mt-2 text-sm font-medium italic leading-relaxed text-violet-200/95">
                  {pattern?.weakness
                    ? `you tend to ${pattern.weakness}`
                    : memorySnippet}
                </p>
                <p className="mt-2 text-xs text-[#94A3B8]">open what kabir knows →</p>
              </Link>
            ) : null}
            <h2 className="mb-7 text-sm font-semibold uppercase tracking-widest text-[#94A3B8]">
              your practice history
            </h2>
            <div className="space-y-4">
              {visibleSessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/notes/${session.id}`}
                  className="block rounded-xl border border-white/[0.08] bg-[#12121a] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-cyan-500/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                          {relativeSessionTime(session.ended_at)}
                        </p>
                        {(session.thread_attempts || 1) > 1 ? (
                          <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-200/90">
                            {session.thread_attempts} attempts
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm font-medium italic leading-relaxed text-cyan-100/95">
                        {session.notes_preview ||
                          session.context ||
                          "session saved"}
                      </p>
                      <p className="mt-2 text-[11px] text-[#64748B]">kabir&apos;s take →</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-cyan-500/50" />
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
                  {showAllSessions ? "show less" : "show more"}
                </button>
              </div>
            )}
          </>
        ) : practiceSessionCount > 0 ? (
          <p className="text-center text-sm leading-relaxed text-[#94A3B8]">
            your last practice is still saving to history, or refresh this page. you’ve
            already completed at least one session — kabir has it.
          </p>
        ) : (
          <p className="text-center text-sm leading-relaxed text-[#94A3B8]">
            new here? tell kabir what&apos;s coming up. he&apos;s heard it all.
          </p>
        )}
      </div>

      {/* Understanding Map — shows if any data exists */}
      {(sessions.length > 0 || patterns.length > 0 || people.length > 0 || goalEntries.length > 0) && (
        <div className="mt-10 border-t border-slate-800/70 pt-10">
          <UnderstandingMap
            sessionCount={sessions.length}
            patterns={patterns}
            people={people}
            goalEntries={goalEntries}
          />
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
          kabir&apos;s thinking…
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}
