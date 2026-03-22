"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mic, ChevronDown } from "lucide-react";
import { extractQuotedSection, type TranscriptMessage } from "@/lib/transcript-stats";
import { SessionOutcomeFollowUp } from "./session-outcome-followup";
import { trackEvent } from "@/lib/analytics";

const TRANSCRIPT_PREVIEW_MESSAGES = 8;
/** Under this, hide session details + confidence */
const SHORT_SESSION_MAX_SECONDS = 180;

type WhatPair = { quote?: string; why?: string };

interface NotesData {
  kabirTake?: string;
  summary?: string;
  whatWorked?: WhatPair | string;
  whatToRethink?: WhatPair | string;
  what_worked?: string;
  what_to_rethink?: string;
  beforeYouWalkIn?: string;
  next_time?: string;
  patternDetected?: string;
  overall_score?: number | null;
  best_moment?: string;
  worst_moment?: string;
  one_thing_to_fix?: string;
}

function renderWithDoubleQuoteHighlights(text: string) {
  if (!text) return null;
  const segments = text.split('"');
  return segments.map((segment, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="font-semibold text-cyan-200/95 [text-shadow:0_0_24px_rgba(34,211,238,0.12)]"
      >
        &quot;{segment}&quot;
      </span>
    ) : (
      <span key={i}>{segment}</span>
    )
  );
}

function getWhatPair(
  notes: NotesData,
  key: "whatWorked" | "whatToRethink",
  legacy: "what_worked" | "what_to_rethink",
  fallbackLegacy: "best_moment" | "worst_moment"
): { quote: string; why: string } {
  const raw = notes[key] ?? notes[legacy] ?? notes[fallbackLegacy];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as WhatPair;
    return {
      quote: (o.quote || "").trim(),
      why: (o.why || "").trim(),
    };
  }
  if (typeof raw === "string" && raw.trim()) {
    const ex = extractQuotedSection(raw);
    return {
      quote: ex.quote,
      why: (ex.rest || raw).trim(),
    };
  }
  return { quote: "", why: "" };
}

function formatDurationDetailed(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return `${m} min ${s} sec`;
}

function normalizeMessages(transcript: unknown): TranscriptMessage[] {
  const shouldDrop = (content: string) => {
    const text = content.trim();
    if (!text) return true;
    if (
      text.includes("You are Kabir.") ||
      text.includes("WHAT YOU KNOW ABOUT THIS PERSON") ||
      text.includes("HOW YOU HELP") ||
      text.includes("NEVER DO THESE THINGS") ||
      text.includes("CONTINUING WHERE YOU LEFT OFF")
    ) {
      return true;
    }
    if (text.length > 2200 && (text.includes("========================") || text.includes("\\n- "))) {
      return true;
    }
    return false;
  };

  if (!transcript) return [];
  if (Array.isArray(transcript)) {
    return transcript
      .map((m) => {
        const row = m as Record<string, unknown>;
        const roleRaw =
          typeof row.role === "string"
            ? row.role
            : typeof row.speaker === "string"
              ? row.speaker
              : "";
        const contentRaw =
          typeof row.content === "string"
            ? row.content
            : typeof row.message === "string"
              ? row.message
              : typeof row.text === "string"
                ? row.text
                : "";
        return {
          role: roleRaw,
          content: contentRaw,
        };
      })
      .filter((m) => {
        const text = (m.content || "").trim();
        return text.length > 0 && !shouldDrop(text);
      });
  }
  if (typeof transcript === "string") {
    try {
      const p = JSON.parse(transcript) as unknown;
      if (Array.isArray(p)) return normalizeMessages(p);
    } catch {
      return [];
    }
  }
  return [];
}

function ConfidenceBar({ score }: { score: number | null }) {
  const p = score == null ? 50 : Math.min(100, Math.max(0, score));
  return (
    <div className="relative flex h-2 w-full overflow-hidden rounded-sm">
      <div className="h-full flex-[1] bg-red-500/80" />
      <div className="h-full flex-[1] bg-amber-500/80" />
      <div className="h-full flex-[1] bg-emerald-600/80" />
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white"
        style={{ left: `calc(${p}% - 1px)` }}
      />
    </div>
  );
}

export function NotesClient({
  sessionId,
  initialNotes,
  initialDate,
  overallScore: initialOverallScore,
  initialSession,
  sessionCreatedAt,
  initialOutcomeSubmitted,
}: {
  sessionId: string;
  initialNotes?: NotesData | null;
  initialDate?: string | null;
  overallScore?: number | null;
  initialSession: {
    duration_seconds: number | null;
    transcript: unknown;
    ended_at: string | null;
  } | null;
  sessionCreatedAt: string | null;
  initialOutcomeSubmitted: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NotesData | null>(initialNotes || null);
  const [loading, setLoading] = useState(!initialNotes);
  const [message, setMessage] = useState(
    "Kabir is reviewing your conversation..."
  );
  const [attempt, setAttempt] = useState(0);
  const generatingRef = useRef(false);
  const [overallScore, setOverallScore] = useState<number | null>(
    initialOverallScore ?? null
  );
  const [session, setSession] = useState(initialSession);
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function continuePractice() {
    setContinuing(true);
    trackEvent("session_continue_clicked", { session_id: sessionId });
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeSessionId: sessionId,
          context: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.sessionId) {
        console.error("Continue session failed:", data);
        trackEvent("session_continue_failed", {
          session_id: sessionId,
          status: res.status,
          error: data?.error || "unknown",
        });
        setContinuing(false);
        return;
      }
      trackEvent("session_continue_succeeded", {
        previous_session_id: sessionId,
        session_id: data.sessionId,
      });
      sessionStorage.setItem(
        `spar_session_${data.sessionId}`,
        JSON.stringify({
          systemPrompt: data.systemPrompt,
          firstMessage:
            data.firstMessage ||
            "Hey. It's Kabir. What conversation are you looking forward to?",
        })
      );
      router.push(`/session/${data.sessionId}`);
    } catch {
      trackEvent("session_continue_failed", {
        session_id: sessionId,
        status: 0,
        error: "network_or_unknown",
      });
      setContinuing(false);
    }
  }

  async function restartPractice() {
    setRestarting(true);
    trackEvent("session_restart_clicked", { session_id: sessionId });
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "restart",
          referenceSessionId: sessionId,
          context: null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.sessionId) {
        console.error("Restart session failed:", data);
        trackEvent("session_restart_failed", {
          session_id: sessionId,
          status: res.status,
          error: data?.error || "unknown",
        });
        setRestarting(false);
        return;
      }
      trackEvent("session_restart_succeeded", {
        previous_session_id: sessionId,
        session_id: data.sessionId,
      });
      sessionStorage.setItem(
        `spar_session_${data.sessionId}`,
        JSON.stringify({
          systemPrompt: data.systemPrompt,
          firstMessage:
            data.firstMessage ||
            "Hey. Let's run this from the top. Give me your opening line when you're ready.",
        })
      );
      router.push(`/session/${data.sessionId}`);
    } catch {
      trackEvent("session_restart_failed", {
        session_id: sessionId,
        status: 0,
        error: "network_or_unknown",
      });
      setRestarting(false);
    }
  }

  useEffect(() => {
    if (notes) return;

    let cancelled = false;

    const tryGetNotes = async () => {
      if (generatingRef.current || cancelled) return;

      try {
        const check = await fetch(`/api/forensics/${sessionId}`);
        const checkData = await check.json();

        if (
          !cancelled &&
          checkData.status === "ready" &&
          checkData.report?.moments
        ) {
          setNotes(checkData.report.moments);
          setOverallScore(checkData.report.overall_score ?? null);
          setLoading(false);
          return;
        }
      } catch {
        /* continue */
      }

      if (generatingRef.current || cancelled) return;
      generatingRef.current = true;

      const messages = [
        "He's picking out the key moments...",
        "Almost there...",
        "Writing his notes...",
      ];
      setMessage(messages[Math.min(attempt, messages.length - 1)]);

      try {
        const res = await fetch(`/api/forensics/${sessionId}`, {
          method: "POST",
        });
        const data = await res.json();

        if (cancelled) return;

        if (data.notes) {
          setNotes(data.notes);
          setOverallScore(
            typeof data.notes.overall_score === "number"
              ? data.notes.overall_score
              : null
          );
          setLoading(false);
          return;
        }

        if (res.status === 400) {
          setMessage("Waiting for call to finish processing...");
        }

        generatingRef.current = false;
      } catch {
        if (!cancelled) generatingRef.current = false;
      }

      if (!cancelled) setAttempt((a) => a + 1);
    };

    const delay = attempt === 0 ? 3000 : attempt < 4 ? 5000 : 8000;
    const timer = setTimeout(tryGetNotes, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, attempt, notes]);

  useEffect(() => {
    if (loading || session?.transcript) return;

    let cancelled = false;
    let attempts = 0;

    const refreshSession = () => {
      fetch(`/api/session/${sessionId}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d.session) return;

          const next = {
            duration_seconds: d.session.duration_seconds,
            transcript: d.session.transcript,
            ended_at: d.session.ended_at,
          };
          setSession(next);

          const hasTranscript =
            Array.isArray(next.transcript) ||
            (typeof next.transcript === "string" &&
              next.transcript.trim().length > 0);
          if (hasTranscript) return;

          attempts += 1;
          if (attempts < 6) {
            window.setTimeout(refreshSession, 1500);
          }
        })
        .catch(() => {
          attempts += 1;
          if (!cancelled && attempts < 6) {
            window.setTimeout(refreshSession, 1500);
          }
        });
    };

    refreshSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId, session?.transcript, loading]);

  const kabirTakeText = useMemo(() => {
    if (!notes) return "";
    return (
      (typeof notes.kabirTake === "string" && notes.kabirTake.trim()
        ? notes.kabirTake
        : null) ||
      (typeof notes.summary === "string" && notes.summary.trim()
        ? notes.summary
        : "") ||
      ""
    );
  }, [notes]);

  const workedPair = useMemo(
    () =>
      notes
        ? getWhatPair(notes, "whatWorked", "what_worked", "best_moment")
        : { quote: "", why: "" },
    [notes]
  );

  const rethinkPair = useMemo(
    () =>
      notes
        ? getWhatPair(notes, "whatToRethink", "what_to_rethink", "worst_moment")
        : { quote: "", why: "" },
    [notes]
  );

  const beforeYouWalkIn =
    (notes?.beforeYouWalkIn && String(notes.beforeYouWalkIn).trim()) ||
    notes?.next_time ||
    notes?.one_thing_to_fix ||
    "";

  const patternDetected =
    typeof notes?.patternDetected === "string"
      ? notes.patternDetected.trim()
      : "";

  const highlightPhrases = useMemo(() => {
    const set = new Set<string>();
    if (!notes) return set;
    if (workedPair.quote.length > 3) set.add(workedPair.quote);
    if (rethinkPair.quote.length > 3) set.add(rethinkPair.quote);
    return set;
  }, [notes, workedPair.quote, rethinkPair.quote]);

  const messages = useMemo(
    () => normalizeMessages(session?.transcript),
    [session?.transcript]
  );

  const transcriptPreview = useMemo(() => {
    if (transcriptExpanded) return messages;
    return messages.slice(0, TRANSCRIPT_PREVIEW_MESSAGES);
  }, [messages, transcriptExpanded]);

  const hasMoreTranscript =
    messages.length > TRANSCRIPT_PREVIEW_MESSAGES;

  async function handleDelete() {
    if (
      !confirm(
        "This will permanently delete the transcript and Kabir's notes. Kabir won't remember this session."
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) router.push("/dashboard");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-[#E2E8F0]">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-slate-700/55 bg-slate-900/55">
          <span className="text-2xl font-medium">K</span>
        </div>
        <p className="text-sm text-slate-300">{message}</p>
        <div className="mt-4 flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-500"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
        {attempt > 10 && (
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-6 rounded border border-slate-600/70 px-5 py-2 text-sm text-slate-300 hover:border-cyan-500/60 hover:text-white"
          >
            Back to dashboard
          </button>
        )}
      </div>
    );
  }

  if (!notes) return null;

  const durationSec = session?.duration_seconds;
  const isShortSession =
    typeof durationSec === "number" &&
    durationSec >= 0 &&
    durationSec < SHORT_SESSION_MAX_SECONDS;

  const dateStr =
    initialDate ||
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  const displayDate =
    typeof dateStr === "string" && dateStr.includes("T")
      ? new Date(dateStr).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      : dateStr;

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/dashboard"
        className="mb-8 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </Link>

      <p className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
        {displayDate}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#E2E8F0]">
        Kabir&apos;s notes
      </h1>

      <div className="mt-10 space-y-10">
        {/* SECTION 1 */}
        <section>
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Kabir&apos;s take
          </h2>
          <div className="rounded-lg border border-slate-600/50 bg-[#0b1d3e]/55 px-5 py-4 text-[15px] leading-relaxed text-[#E2E8F0] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <p className="font-[450] text-slate-50">
              {kabirTakeText
                ? renderWithDoubleQuoteHighlights(kabirTakeText)
                : "—"}
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Your words
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Your strongest line and the one to rethink — tied to what you
            actually said.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div
              className="rounded-lg border-l-2 border-emerald-500/70 bg-[#0b1d3e]/45 px-4 py-4"
              style={{
                borderTopWidth: 0,
                borderRightWidth: 0,
                borderBottomWidth: 0,
              }}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-500/90">
                What worked
              </p>
              <p className="mt-3 text-base font-semibold leading-snug text-[#E2E8F0]">
                {workedPair.quote ? (
                  <span className="text-[#ecfdf5]">&ldquo;{workedPair.quote}&rdquo;</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </p>
              {workedPair.why ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {workedPair.why}
                </p>
              ) : null}
            </div>
            <div
              className="rounded-lg border-l-2 border-amber-500/70 bg-[#0b1d3e]/45 px-4 py-4"
              style={{
                borderTopWidth: 0,
                borderRightWidth: 0,
                borderBottomWidth: 0,
              }}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-amber-500/90">
                What to rethink
              </p>
              <p className="mt-3 text-base font-semibold leading-snug text-[#E2E8F0]">
                {rethinkPair.quote ? (
                  <span className="text-[#fff7ed]">&ldquo;{rethinkPair.quote}&rdquo;</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </p>
              {rethinkPair.why ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {rethinkPair.why}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {patternDetected ? (
          <section className="rounded-lg border-l-[3px] border-violet-500/55 bg-violet-950/20 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-widest text-violet-300/90">
              Something I noticed
            </h2>
            <p className="text-[15px] leading-relaxed text-violet-100/95">
              {patternDetected}
            </p>
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-slate-400">
            Before you walk in
          </h2>
          <div className="rounded-lg border border-slate-500/45 bg-[#071a38]/90 px-6 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="text-xl font-semibold leading-snug tracking-tight text-[#F8FAFC] sm:text-[1.35rem] sm:leading-snug">
              {beforeYouWalkIn || "—"}
            </p>
          </div>
        </section>

        {/* Session details — only for sessions longer than 3 minutes */}
        {!isShortSession ? (
          <section>
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex w-full items-center justify-between border-b border-slate-700/40 py-2 text-left"
            >
              <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
                Session details
              </span>
              <ChevronDown
                className={`h-4 w-4 text-slate-400 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {detailsOpen && (
              <div className="mt-4 space-y-4 font-mono text-xs text-slate-300">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Duration
                  </p>
                  <p className="mt-1 text-[#E2E8F0]">
                    {formatDurationDetailed(session?.duration_seconds)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">
                    Session confidence (estimate)
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    A rough read of how ready you sounded for the real
                    conversation—not talk-time or word counts (those are noisy
                    from voice transcripts).
                  </p>
                  <p className="mt-2 font-mono text-sm text-[#E2E8F0]">
                    {(overallScore ?? notes.overall_score) != null
                      ? `${Math.round(Number(overallScore ?? notes.overall_score))} / 100`
                      : "—"}
                  </p>
                  <div className="mt-2">
                    <ConfidenceBar
                      score={overallScore ?? notes.overall_score ?? null}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {/* SECTION 5 */}
        <section>
          <button
            type="button"
            onClick={() =>
              setTranscriptOpen((o) => {
                const next = !o;
                if (!next) setTranscriptExpanded(false);
                return next;
              })
            }
            className="flex w-full items-center justify-between border-b border-slate-700/40 py-2 text-left"
          >
            <span className="text-[11px] font-medium uppercase tracking-widest text-slate-400">
              Full conversation
            </span>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${transcriptOpen ? "rotate-180" : ""}`}
            />
          </button>
          {transcriptOpen && (
            <div className="mt-4 space-y-3 text-sm">
              {messages.length === 0 ? (
                <p className="text-slate-400">Transcript not available yet.</p>
              ) : (
                transcriptPreview.map((m, i) => {
                  const role = (m.role || "").toLowerCase();
                  const isUser =
                    role === "user" || role === "customer";
                  const content = m.content || "";
                  const isHighlight = isUser && [...highlightPhrases].some(
                    (q) => q && content.includes(q)
                  );
                  return (
                    <div
                      key={i}
                      className={`rounded px-2 py-1.5 ${
                        isHighlight ? "bg-emerald-950/25" : ""
                      }`}
                    >
                      <span
                        className="text-[10px] font-mono uppercase tracking-wider text-slate-500"
                      >
                        {isUser ? "You" : "Kabir"}
                      </span>
                      <p
                        className="mt-0.5 whitespace-pre-wrap"
                        style={{
                          color: isUser ? "#E2E8F0" : "#94A3B8",
                        }}
                      >
                        {content}
                      </p>
                    </div>
                  );
                })
              )}
              {messages.length > 0 &&
              hasMoreTranscript &&
              !transcriptExpanded ? (
                <button
                  type="button"
                  onClick={() => setTranscriptExpanded(true)}
                  className="mt-2 w-full rounded border border-slate-600/60 bg-slate-900/40 py-2 text-xs font-medium text-cyan-200/90 transition-colors hover:border-cyan-500/50 hover:bg-slate-900/60"
                >
                  Read full transcript ({messages.length} messages)
                </button>
              ) : null}
              {messages.length > 0 &&
              hasMoreTranscript &&
              transcriptExpanded ? (
                <button
                  type="button"
                  onClick={() => setTranscriptExpanded(false)}
                  className="mt-2 w-full rounded border border-slate-700/50 py-2 text-xs text-slate-400 hover:text-slate-200"
                >
                  Show less
                </button>
              ) : null}
            </div>
          )}
        </section>

        {/* SECTION 6 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={restarting}
            onClick={restartPractice}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded border border-emerald-600/80 bg-emerald-600/20 px-5 py-3 text-center text-sm font-medium text-emerald-100 hover:bg-emerald-600/30"
          >
            <Mic className="h-4 w-4" />
            {restarting ? "Starting…" : "Practice again"}
          </button>
          <button
            type="button"
            disabled={continuing}
            onClick={continuePractice}
            className="inline-flex flex-1 items-center justify-center rounded border border-cyan-500/50 bg-cyan-500/10 px-5 py-3 text-center text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/70 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {continuing ? "Starting…" : "Continue this practice"}
          </button>
        </div>

        <SessionOutcomeFollowUp
          sessionId={sessionId}
          sessionCreatedAt={sessionCreatedAt}
          initialSubmitted={initialOutcomeSubmitted}
        />

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="mt-2 w-full text-center text-xs text-slate-500 underline hover:text-slate-300 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete this session"}
        </button>
      </div>
    </div>
  );
}
