"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Mic,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";
import { extractQuotedSection, type TranscriptMessage } from "@/lib/transcript-stats";
import { SessionOutcomeFollowUp } from "./session-outcome-followup";
import { trackEvent } from "@/lib/analytics";

const TRANSCRIPT_PREVIEW_MESSAGES = 8;
const CARD = "rgba(11, 29, 62, 0.55)";
const BEFORE_BG = "rgba(7, 26, 56, 0.7)";

type Moment = { quote?: string; timestamp?: string; why?: string };
type WordPattern = {
  fillerCount: number;
  topFillers: string[];
  hedgeCount: number;
  hedgePhrases: string[];
  apologyCount: number;
};

interface NotesData {
  kabirTake?: string;
  summary?: string;
  /** Kabir's plain-language readiness (no numbers) */
  readiness?: string;
  /** @deprecated Old notes only */
  readinessLabel?: string;
  strongestMoment?: Moment;
  weakestMoment?: Moment;
  whatWorked?: { quote?: string; why?: string } | string;
  whatToRethink?: { quote?: string; why?: string } | string;
  what_worked?: string;
  what_to_rethink?: string;
  actionItems?: string[];
  wordPattern?: WordPattern;
  beforeYouWalkIn?: string;
  next_time?: string;
  patternDetected?: string;
  best_moment?: string;
  worst_moment?: string;
  one_thing_to_fix?: string;
}

/** Text shown for ARE YOU READY (new `readiness` field or legacy label mapping). */
function getReadinessDisplay(notes: NotesData): string {
  const r = typeof notes.readiness === "string" ? notes.readiness.trim() : "";
  if (r) return r;
  const lbl =
    typeof notes.readinessLabel === "string" ? notes.readinessLabel.trim() : "";
  if (lbl === "You're ready") {
    return "You are ready. You said what you needed to say and you said it clearly. Go do it. Call me after.";
  }
  if (lbl === "Almost" || lbl === "Getting there") {
    return "Your opening is solid. But when I pushed back you softened everything. Practice the pushback once more before you go in.";
  }
  if (lbl === "Not ready yet") {
    return "Honestly, not yet. You are still circling around the thing you need to say instead of saying it. Call me back. We will get there.";
  }
  if (lbl === "Not scored yet") {
    return "I did not hear enough to tell you. Give me 5 minutes next time and I will give you a real answer.";
  }
  return "This session was saved before Kabir's readiness note. Start a new practice to see his honest read.";
}

/** True when Kabir's read is fully supportive — primary CTA is affirming, not restart. */
function isReadinessAffirming(notes: NotesData, readinessText: string): boolean {
  const t = readinessText.toLowerCase();
  if (t.includes("you are ready")) return true;
  const lbl = notes.readinessLabel;
  if (typeof lbl === "string" && lbl.includes("You're ready")) return true;
  return false;
}

function renderWithDoubleQuoteHighlights(text: string) {
  if (!text) return null;
  const segments = text.split('"');
  return segments.map((segment, i) =>
    i % 2 === 1 ? (
      <span
        key={i}
        className="font-medium italic text-cyan-200/95"
      >
        &quot;{segment}&quot;
      </span>
    ) : (
      <span key={i}>{segment}</span>
    )
  );
}

function getLegacyPair(
  notes: NotesData,
  key: "whatWorked" | "whatToRethink",
  legacy: "what_worked" | "what_to_rethink",
  fallback: "best_moment" | "worst_moment"
): { quote: string; why: string } {
  const raw = notes[key] ?? notes[legacy] ?? notes[fallback];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as { quote?: string; why?: string };
    return { quote: (o.quote || "").trim(), why: (o.why || "").trim() };
  }
  if (typeof raw === "string" && raw.trim()) {
    const ex = extractQuotedSection(raw);
    return { quote: ex.quote, why: (ex.rest || raw).trim() };
  }
  return { quote: "", why: "" };
}

function getMoment(
  notes: NotesData,
  primary: "strongestMoment" | "weakestMoment",
  legacyKey: "whatWorked" | "whatToRethink",
  legacyStr: "what_worked" | "what_to_rethink",
  legacyFb: "best_moment" | "worst_moment"
): Moment {
  const m = notes[primary];
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const o = m as Moment;
    if (o.quote || o.why || o.timestamp) return { ...o };
  }
  const p = getLegacyPair(notes, legacyKey, legacyStr, legacyFb);
  return { quote: p.quote, why: p.why, timestamp: "" };
}

function statHeatClass(n: number): string {
  if (n <= 2) return "text-emerald-400";
  if (n <= 5) return "text-amber-400";
  return "text-red-400";
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
    if (
      text.length > 2200 &&
      (text.includes("========================") || text.includes("\\n- "))
    ) {
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
        return { role: roleRaw, content: contentRaw };
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

export function NotesClient({
  sessionId,
  initialNotes,
  initialDate,
  initialSession,
  sessionCreatedAt,
  initialOutcomeSubmitted,
}: {
  sessionId: string;
  initialNotes?: NotesData | null;
  initialDate?: string | null;
  initialSession: {
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
  const [session, setSession] = useState(initialSession);
  const [deleting, setDeleting] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [sessionStartError, setSessionStartError] = useState<string | null>(
    null
  );
  const [copiedBefore, setCopiedBefore] = useState(false);

  async function restartPractice() {
    setRestarting(true);
    setSessionStartError(null);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sessionId) {
        trackEvent("session_restart_failed", {
          session_id: sessionId,
          status: res.status,
          error: data?.error || "unknown",
        });
        setSessionStartError(
          data?.message ||
            data?.error ||
            "Could not start another session right now."
        );
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
          maxDurationSeconds: data.maxDurationSeconds,
          cap: data.cap,
        })
      );
      router.push(`/session/${data.sessionId}`);
    } catch {
      trackEvent("session_restart_failed", {
        session_id: sessionId,
        status: 0,
        error: "network_or_unknown",
      });
      setSessionStartError("Could not start another session right now.");
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

  const strongest = useMemo(
    () =>
      notes
        ? getMoment(
            notes,
            "strongestMoment",
            "whatWorked",
            "what_worked",
            "best_moment"
          )
        : { quote: "", why: "", timestamp: "" },
    [notes]
  );

  const weakest = useMemo(
    () =>
      notes
        ? getMoment(
            notes,
            "weakestMoment",
            "whatToRethink",
            "what_to_rethink",
            "worst_moment"
          )
        : { quote: "", why: "", timestamp: "" },
    [notes]
  );

  const actionItems = useMemo(() => {
    if (!notes?.actionItems || !Array.isArray(notes.actionItems)) return [];
    return notes.actionItems.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
  }, [notes]);

  const wordPattern = useMemo((): WordPattern => {
    const wp = notes?.wordPattern;
    if (wp && typeof wp === "object") {
      return {
        fillerCount: Math.max(0, Number(wp.fillerCount) || 0),
        topFillers: Array.isArray(wp.topFillers)
          ? wp.topFillers.filter((x) => typeof x === "string")
          : [],
        hedgeCount: Math.max(0, Number(wp.hedgeCount) || 0),
        hedgePhrases: Array.isArray(wp.hedgePhrases)
          ? wp.hedgePhrases.filter((x) => typeof x === "string")
          : [],
        apologyCount: Math.max(0, Number(wp.apologyCount) || 0),
      };
    }
    return {
      fillerCount: 0,
      topFillers: [],
      hedgeCount: 0,
      hedgePhrases: [],
      apologyCount: 0,
    };
  }, [notes]);

  const beforeYouWalkIn =
    (notes?.beforeYouWalkIn && String(notes.beforeYouWalkIn).trim()) ||
    notes?.next_time ||
    notes?.one_thing_to_fix ||
    "";

  const readinessParagraph = useMemo(() => {
    if (!notes) return "";
    return getReadinessDisplay(notes);
  }, [notes]);

  const primaryCtaAffirming = useMemo(() => {
    if (!notes) return false;
    return isReadinessAffirming(notes, readinessParagraph);
  }, [notes, readinessParagraph]);

  const highlightPhrases = useMemo(() => {
    const set = new Set<string>();
    if (!notes) return set;
    if (strongest.quote && strongest.quote.length > 3)
      set.add(strongest.quote);
    if (weakest.quote && weakest.quote.length > 3) set.add(weakest.quote);
    return set;
  }, [notes, strongest.quote, weakest.quote]);

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

  async function copyBeforeYouWalkIn() {
    if (!beforeYouWalkIn) return;
    try {
      await navigator.clipboard.writeText(beforeYouWalkIn);
      setCopiedBefore(true);
      trackEvent("notes_copy_before_walk_in", { session_id: sessionId });
      window.setTimeout(() => setCopiedBefore(false), 2000);
    } catch {
      /* noop */
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
    <div className="px-4 pb-16 pt-6 sm:px-6">
      <div className="mx-auto max-w-lg">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </Link>

        <p
          className="font-mono text-[11px] uppercase tracking-wider text-slate-400"
          style={{ fontFamily: "var(--font-ibm-mono), ui-monospace, monospace" }}
        >
          {displayDate}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[#E2E8F0]">
          Kabir&apos;s notes
        </h1>

        {/* SECTION 1 — KABIR'S TAKE */}
        <section className="mt-10 border-l-2 border-cyan-500/50 pl-4">
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400"
            style={{ fontFamily: "var(--font-ibm-mono), ui-monospace, monospace" }}
          >
            Kabir&apos;s take
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#E2E8F0]">
            {kabirTakeText
              ? renderWithDoubleQuoteHighlights(kabirTakeText)
              : "—"}
          </p>
        </section>

        {/* SECTION 2 — YOUR MOMENTS */}
        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Your moments
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div
              className="rounded-lg border border-[#1E1E2E] p-4 pl-3"
              style={{
                background: CARD,
                borderLeftWidth: 3,
                borderLeftColor: "#10B981",
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Strongest
              </p>
              <p className="mt-2 text-[15px] font-medium leading-snug text-[#E2E8F0]">
                {strongest.quote ? (
                  <>
                    &ldquo;{strongest.quote}&rdquo;
                  </>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </p>
              {strongest.timestamp ? (
                <span className="mt-2 inline-block rounded-full bg-slate-800/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                  {strongest.timestamp}
                </span>
              ) : null}
              {strongest.why ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {strongest.why}
                </p>
              ) : null}
            </div>
            <div
              className="rounded-lg border border-[#1E1E2E] p-4 pl-3"
              style={{
                background: CARD,
                borderLeftWidth: 3,
                borderLeftColor: "#F59E0B",
              }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                Rethink
              </p>
              <p className="mt-2 text-[15px] font-medium leading-snug text-[#E2E8F0]">
                {weakest.quote ? (
                  <>
                    &ldquo;{weakest.quote}&rdquo;
                  </>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </p>
              {weakest.timestamp ? (
                <span className="mt-2 inline-block rounded-full bg-slate-800/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                  {weakest.timestamp}
                </span>
              ) : null}
              {weakest.why ? (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {weakest.why}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {/* SECTION 3 — GAME PLAN */}
        {actionItems.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Your game plan
            </h2>
            <ul className="mt-4 space-y-3">
              {actionItems.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-[#1E1E2E] p-3"
                  style={{ background: CARD }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 font-mono text-sm font-semibold text-cyan-400"
                    style={{
                      fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
                    }}
                  >
                    {i + 1}
                  </span>
                  <p className="flex-1 pt-1 text-sm leading-relaxed text-[#E2E8F0]">
                    {item}
                  </p>
                  <div
                    className="mt-1 h-4 w-4 shrink-0 rounded border border-slate-600"
                    aria-hidden
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* SECTION 4 — WORD PATTERNS */}
        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Patterns Kabir noticed
          </h2>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            From your side of the conversation only (not Kabir). When something
            is listed below, those are the words or phrases that showed up.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            <div
              className="rounded-lg border border-[#1E1E2E] p-3 text-center"
              style={{ background: CARD }}
            >
              <p
                className={`font-mono text-2xl font-bold leading-none ${statHeatClass(wordPattern.fillerCount)}`}
                style={{
                  fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
                }}
              >
                {wordPattern.fillerCount}
              </p>
              <p className="mt-2 text-[10px] text-slate-400">filler words</p>
              <p className="mt-2 text-[10px] leading-snug text-slate-400">
                {wordPattern.fillerCount === 0
                  ? "No filler words like um, uh, or like stood out in what you said."
                  : wordPattern.topFillers.length > 0
                    ? `Examples: ${wordPattern.topFillers.slice(0, 5).join(", ")}`
                    : `${wordPattern.fillerCount} instance${wordPattern.fillerCount === 1 ? "" : "s"} — see Kabir’s take for where they appeared.`}
              </p>
            </div>
            <div
              className="rounded-lg border border-[#1E1E2E] p-3 text-center"
              style={{ background: CARD }}
            >
              <p
                className={`font-mono text-2xl font-bold leading-none ${statHeatClass(wordPattern.hedgeCount)}`}
                style={{
                  fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
                }}
              >
                {wordPattern.hedgeCount}
              </p>
              <p className="mt-2 text-[10px] text-slate-400">hedges</p>
              <p className="mt-2 text-[10px] leading-snug text-slate-400">
                {wordPattern.hedgeCount === 0
                  ? "No hedging phrases like “I guess” or “maybe” stood out in your lines."
                  : wordPattern.hedgePhrases.length > 0
                    ? `Examples: ${wordPattern.hedgePhrases.slice(0, 4).join(", ")}`
                    : `${wordPattern.hedgeCount} hedge${wordPattern.hedgeCount === 1 ? "" : "s"} — see Kabir’s take for where they appeared.`}
              </p>
            </div>
            <div
              className="rounded-lg border border-[#1E1E2E] p-3 text-center"
              style={{ background: CARD }}
            >
              {wordPattern.apologyCount === 0 ? (
                <>
                  <div className="flex items-center justify-center gap-1 text-emerald-400">
                    <Check className="h-6 w-6" strokeWidth={2.5} />
                  </div>
                  <p className="mt-1 text-[10px] font-medium text-emerald-400/90">
                    none detected
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    unnecessary apologies
                  </p>
                </>
              ) : (
                <>
                  <p
                    className={`font-mono text-2xl font-bold leading-none ${statHeatClass(wordPattern.apologyCount)}`}
                    style={{
                      fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
                    }}
                  >
                    {wordPattern.apologyCount}
                  </p>
                  <p className="mt-2 text-[10px] leading-tight text-slate-400">
                    unnecessary apologies
                  </p>
                  <p className="mt-2 text-[10px] leading-snug text-slate-500">
                    Sorry / apologize-type lines counted when they weren’t
                    needed for the moment.
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 5 — BEFORE YOU WALK IN */}
        <section
          className="mt-12 rounded-xl px-5 py-8 sm:px-8"
          style={{ background: BEFORE_BG }}
        >
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400"
            style={{ fontFamily: "var(--font-ibm-mono), ui-monospace, monospace" }}
          >
            Before you walk in
          </h2>
          <p className="mt-4 text-[18px] font-medium leading-snug text-[#E2E8F0] sm:text-[20px]">
            {beforeYouWalkIn || "—"}
          </p>
          <button
            type="button"
            onClick={() => void copyBeforeYouWalkIn()}
            disabled={!beforeYouWalkIn}
            className="mt-5 inline-flex items-center gap-2 text-xs text-cyan-400/90 transition-colors hover:text-cyan-300 disabled:opacity-40"
          >
            {copiedBefore ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copiedBefore ? "Copied" : "Copy this"}
          </button>
        </section>

        {/* ARE YOU READY — Kabir's honest read (no scoring) */}
        <section className="mt-14">
          <h2
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400"
            style={{
              fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
            }}
          >
            ARE YOU READY?
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-[#E2E8F0] sm:text-[18px]">
            {readinessParagraph}
          </p>
        </section>

        {/* CTAs */}
        <section className="mt-10 space-y-3">
          {sessionStartError ? (
            <p className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
              {sessionStartError}
            </p>
          ) : null}
          {primaryCtaAffirming ? (
            <button
              type="button"
              className="flex w-full cursor-default items-center justify-center rounded-lg bg-cyan-600 px-5 py-3.5 text-sm font-semibold text-white"
            >
              You got this. Go.
            </button>
          ) : (
            <button
              type="button"
              disabled={restarting}
              onClick={restartPractice}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              <Mic className="h-4 w-4" />
              {restarting ? "Starting…" : "Practice again"}
            </button>
          )}
          <button
            type="button"
            title="Coming soon"
            className="flex w-full items-center justify-center rounded-lg border border-slate-600 bg-transparent px-5 py-3.5 text-sm font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-900/40"
          >
            Call me after the real thing
          </button>
          <p className="text-center text-[10px] leading-relaxed text-slate-500">
            Your conversations are encrypted.
          </p>
        </section>

        {/* Transcript (collapsible) */}
        <section className="mt-10 border-t border-slate-800/80 pt-6">
          <button
            type="button"
            onClick={() =>
              setTranscriptOpen((o) => {
                const next = !o;
                if (!next) setTranscriptExpanded(false);
                return next;
              })
            }
            className="flex w-full items-center justify-between py-2 text-left"
          >
            <span
              className="font-mono text-[10px] uppercase tracking-wider text-slate-400"
              style={{
                fontFamily: "var(--font-ibm-mono), ui-monospace, monospace",
              }}
            >
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
                  const isHighlight =
                    isUser &&
                    [...highlightPhrases].some((q) => q && content.includes(q));
                  return (
                    <div
                      key={i}
                      className={`rounded px-2 py-1.5 ${
                        isHighlight ? "bg-emerald-950/20" : ""
                      }`}
                    >
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        {isUser ? "You" : "Kabir"}
                      </span>
                      <p
                        className="mt-0.5 whitespace-pre-wrap text-slate-300"
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
                  className="mt-2 w-full rounded border border-slate-700 py-2 text-xs text-cyan-400/90 hover:border-cyan-600/50"
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
                  className="mt-2 w-full py-2 text-xs text-slate-400 hover:text-slate-300"
                >
                  Show less
                </button>
              ) : null}
            </div>
          )}
        </section>

        <SessionOutcomeFollowUp
          sessionId={sessionId}
          sessionCreatedAt={sessionCreatedAt}
          initialSubmitted={initialOutcomeSubmitted}
        />

        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="mt-8 w-full text-center text-xs text-slate-500 underline hover:text-slate-300 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete this session"}
        </button>
      </div>
    </div>
  );
}
