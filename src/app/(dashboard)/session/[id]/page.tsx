"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Paperclip, Loader2, Check, Star, Send, MessageSquareText } from "lucide-react";
import Vapi from "@vapi-ai/web";
import { useUser } from "@clerk/nextjs";
import { startPracticeReplaySession, trackEvent } from "@/lib/analytics";

type SessionStatus =
  | "trust"
  | "connecting"
  | "active"
  | "ended"
  | "feedback"
  | "error";
type SpeakingState = "listening" | "kabir" | "idle";

type LiveMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  source: "voice" | "typed" | "file" | "status";
  content: string;
};

type ContextSummary = {
  contextChars?: number;
  files?: string[];
};

const SILENCE_NUDGE_SECONDS = 20;
const SILENCE_AUTO_END_SECONDS = 30;

function hasNegatedEndIntent(text: string): boolean {
  return /\b(don['’]?t|do not|not now|keep going|continue)\b.*\b(end|stop|hang\s*up|finish)\b/i.test(
    text
  );
}

function hasEndIntent(text: string): boolean {
  return /\b(end|stop|finish|wrap\s*up|hang\s*up)\b.*\b(session|call|conversation)?\b/i.test(
    text
  );
}

function hasSpecificSessionEndIntent(text: string): boolean {
  return /\b(end|stop|finish|wrap\s*up|hang\s*up)\b\s+(the\s+|this\s+|my\s+)?\b(session|call|conversation)\b/i.test(
    text
  );
}

function hasImmediateEndIntent(text: string): boolean {
  return /\b(end|stop|finish|hang\s*up)\b.*\b(now|right now|immediately|please)\b/i.test(text);
}

function hasEndConfirmation(text: string): boolean {
  return /\b(yes|confirm|go ahead|do it|end now|stop now)\b/i.test(text);
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { user, isLoaded: userLoaded } = useUser();
  const [trustAcknowledged, setTrustAcknowledged] = useState(false);
  const [status, setStatus] = useState<SessionStatus>("trust");
  const [speaking, setSpeaking] = useState<SpeakingState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [attachStatus, setAttachStatus] = useState<
    "idle" | "processing" | "done"
  >("idle");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vapiRef = useRef<Vapi | null>(null);
  const callIdRef = useRef<string | null>(null);
  const endingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [capHint, setCapHint] = useState<string | null>(null);
  const [callRating, setCallRating] = useState<number | null>(null);
  const [recommendScore, setRecommendScore] = useState<number | null>(null);
  const [callFeedback, setCallFeedback] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [midContextDraft, setMidContextDraft] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [midContextSaving, setMidContextSaving] = useState(false);
  const [midContextSaved, setMidContextSaved] = useState(false);
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([]);
  const [contextSummary, setContextSummary] = useState<ContextSummary | null>(null);
  const [silenceBanner, setSilenceBanner] = useState<string | null>(null);
  const replayStartSentRef = useRef(false);
  const lastUserActivityRef = useRef(Date.now());
  const silenceNudgedRef = useRef(false);
  const autoEndedForSilenceRef = useRef(false);
  const pendingEndConfirmUntilRef = useRef<number | null>(null);
  const endSessionRef = useRef<
    ((reason?: "manual" | "silence_auto" | "user_voice_request") => Promise<void>) | null
  >(null);

  const appendLiveMessage = useCallback((message: Omit<LiveMessage, "id">) => {
    setLiveMessages((prev) => [
      ...prev.slice(-39),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...message,
      },
    ]);
  }, []);

  const markUserActivity = useCallback(() => {
    lastUserActivityRef.current = Date.now();
    silenceNudgedRef.current = false;
    autoEndedForSilenceRef.current = false;
    setSilenceBanner(null);
  }, []);

  useEffect(() => {
    document.body.classList.add("session-active-route");
    return () => {
      document.body.classList.remove("session-active-route");
    };
  }, []);

  useEffect(() => {
    if (!id || !userLoaded || !user?.id || replayStartSentRef.current) return;
    replayStartSentRef.current = true;
    startPracticeReplaySession({
      source: "session_page_mount",
      session_id: id,
      user_id: user.id,
    });
  }, [id, userLoaded, user?.id]);

  useEffect(() => {
    if (!id) {
      router.replace("/dashboard");
      return;
    }

    const raw = sessionStorage.getItem(`spar_session_${id}`);
    if (!raw) {
      router.replace("/dashboard");
      return;
    }

    if (!trustAcknowledged) {
      return;
    }

    const parsed = JSON.parse(raw) as {
      systemPrompt: string;
      firstMessage?: string;
      maxDurationSeconds?: number;
      cap?: { sessionTimeMessage?: string };
      contextSummary?: ContextSummary;
    };
    const { systemPrompt, firstMessage } = parsed;
    if (parsed.contextSummary) {
      setContextSummary(parsed.contextSummary);
    }

    const sessionMaxDuration =
      typeof parsed.maxDurationSeconds === "number" && parsed.maxDurationSeconds > 0
        ? parsed.maxDurationSeconds
        : 600;
    if (parsed.cap?.sessionTimeMessage) {
      setCapHint(parsed.cap.sessionTimeMessage);
    }

    queueMicrotask(() => setStatus("connecting"));

    const vapi = new Vapi(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY!);
    vapiRef.current = vapi;

    vapi.on("call-start", async () => {
      setStatus("active");
      markUserActivity();
      try {
        await vapi.increaseMicLevel(1.15);
      } catch {
        /* noop */
      }
    });
    vapi.on("call-end", () => {
      setStatus("ended");
      if (timerRef.current) clearInterval(timerRef.current);
    });

    vapi.on("speech-start", () => {
      setSpeaking("kabir");
      markUserActivity();
    });
    vapi.on("speech-end", () => {
      setSpeaking("listening");
      // Start silence countdown after Kabir finishes, not during his turn.
      markUserActivity();
    });

    vapi.on("message", (payload: unknown) => {
      const body = (payload as { message?: Record<string, unknown> })?.message;
      const row = (body || payload || {}) as Record<string, unknown>;
      const roleRaw =
        typeof row.role === "string"
          ? row.role
          : typeof row.speaker === "string"
            ? row.speaker
            : typeof row.from === "string"
              ? row.from
              : "";
      const role = roleRaw.toLowerCase();
      const textRaw =
        typeof row.content === "string"
          ? row.content
          : typeof row.message === "string"
            ? row.message
            : typeof row.text === "string"
              ? row.text
              : "";
      const text = textRaw.trim();
      if (!text) return;

      if (role.includes("assistant") || role.includes("bot") || role.includes("agent")) {
        markUserActivity();
        appendLiveMessage({ role: "assistant", source: "voice", content: text });
        return;
      }

      if (role.includes("user") || role.includes("customer")) {
        markUserActivity();
        appendLiveMessage({ role: "user", source: "voice", content: text });
        const now = Date.now();
        const pendingUntil = pendingEndConfirmUntilRef.current;
        const withinConfirmWindow = Boolean(pendingUntil && now < pendingUntil);

        if (withinConfirmWindow && hasEndConfirmation(text) && !endingRef.current) {
          pendingEndConfirmUntilRef.current = null;
          setSilenceBanner("Confirmed. Ending this session now.");
          void endSessionRef.current?.("user_voice_request");
          return;
        }

        if (hasNegatedEndIntent(text)) {
          pendingEndConfirmUntilRef.current = null;
          setSilenceBanner("Okay, I will not end right now.");
          return;
        }

        if (hasEndIntent(text) && !endingRef.current) {
          if (hasImmediateEndIntent(text) || (withinConfirmWindow && hasEndConfirmation(text))) {
            pendingEndConfirmUntilRef.current = null;
            setSilenceBanner("Heard you. Ending this session now.");
            void endSessionRef.current?.("user_voice_request");
            return;
          }

          if (hasSpecificSessionEndIntent(text)) {
            pendingEndConfirmUntilRef.current = null;
            setSilenceBanner("Heard you. Ending this session now.");
            void endSessionRef.current?.("user_voice_request");
            return;
          }

          pendingEndConfirmUntilRef.current = now + 12000;
          setSilenceBanner("Say 'end session now' to confirm, or keep talking to continue.");
          const vapi = vapiRef.current;
          if (vapi) {
            vapi.send({
              type: "add-message",
              triggerResponseEnabled: true,
              message: {
                role: "system",
                content:
                  "User might want to end the call. Ask once for explicit confirmation. If they do not confirm, continue coaching.",
              },
            });
          }
        }
      }
    });

    vapi.on("error", (e: unknown) => {
      const errDetail =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null
            ? JSON.stringify(e, Object.getOwnPropertyNames(e))
            : String(e);
      console.error("Vapi error:", errDetail);
      setStatus("error");
      setErrorMsg(
        "Could not connect. Check microphone permissions and try again."
      );
    });

    vapi
      .start({
        name: "Kabir",
        model: {
          provider: "openai",
          model: "gpt-4o",
          messages: [{ role: "system", content: systemPrompt }],
        },
        voice: {
          provider: "vapi",
          voiceId: "Rohan",
        },
        firstMessage:
          firstMessage ||
          "Hey. It's Kabir. What conversation are you looking forward to?",
        maxDurationSeconds: sessionMaxDuration,
        startSpeakingPlan: {
          waitSeconds: 0.85,
          smartEndpointingEnabled: true,
        },
        stopSpeakingPlan: {
          numWords: 2,
          voiceSeconds: 0.22,
          backoffSeconds: 0.95,
        },
      })
      .then(async (call) => {
        if (call?.id) {
          callIdRef.current = call.id;
          await fetch(`/api/session/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vapiCallId: call.id }),
          });
        }
      })
      .catch((err) => {
        console.error("Vapi start failed:", err);
        setStatus("error");
        setErrorMsg("Failed to start call. Please try again.");
      });

    return () => {
      vapi.stop();
      vapiRef.current = null;
    };
  }, [
    id,
    router,
    trustAcknowledged,
    appendLiveMessage,
    markUserActivity,
  ]);

  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  useEffect(() => {
    if (status !== "active") return;
    const interval = window.setInterval(() => {
      if (endingRef.current || speaking === "kabir") return;
      if (composerFocused || midContextDraft.trim().length > 0 || midContextSaving) {
        markUserActivity();
        return;
      }
      const idleSeconds = (Date.now() - lastUserActivityRef.current) / 1000;

      if (idleSeconds >= SILENCE_NUDGE_SECONDS && !silenceNudgedRef.current) {
        silenceNudgedRef.current = true;
        setSilenceBanner("Still there? I will end this session in 10 seconds if it stays silent.");
        appendLiveMessage({
          role: "system",
          source: "status",
          content: "Silence detected: we will wrap in 10 seconds unless you continue.",
        });
        const vapi = vapiRef.current;
        if (vapi) {
          vapi.send({
            type: "add-message",
            triggerResponseEnabled: true,
            message: {
              role: "system",
              content:
                "The user has been silent for a while. Give a very short and kind nudge and mention the session will auto-end after 30 seconds of silence.",
            },
          });
        }
      }

      if (idleSeconds >= SILENCE_AUTO_END_SECONDS && !autoEndedForSilenceRef.current) {
        autoEndedForSilenceRef.current = true;
        setSilenceBanner("Ending now after 30 seconds of silence.");
        void endSessionRef.current?.("silence_auto");
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    status,
    speaking,
    appendLiveMessage,
    composerFocused,
    midContextDraft,
    midContextSaving,
    markUserActivity,
  ]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !vapiRef.current) return;

      const vapi = vapiRef.current;

      setAttachError(null);
      setAttachStatus("processing");
      trackEvent("attachment_upload_started", {
        source: "session",
        session_id: id,
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
          setAttachStatus("idle");
          setAttachError(data?.error || "Could not process this file.");
          trackEvent("attachment_upload_failed", {
            source: "session",
            session_id: id,
            status: res.status,
            error: data?.error || "unknown",
          });
          return;
        }

        if (!data.text?.trim()) {
          setAttachStatus("idle");
          setAttachError("Could not read text from this file. Try PDF, TXT, or an image.");
          return;
        }

        if (vapi) {
          const excerpt =
            data.text.length > 14_000
              ? `${data.text.slice(0, 14_000)}\n\n[Truncated — file was long]`
              : data.text;
          markUserActivity();
          // User-role + triggerResponse so the assistant actually speaks; system-only
          // injections often never get a spoken reply in live calls.
          vapi.send({
            type: "add-message",
            triggerResponseEnabled: true,
            message: {
              role: "user",
              content:
                `[The user shared a file during this call: "${file.name}". Here is the extracted text. Acknowledge briefly that you received it, reference one or two relevant details if useful, then continue helping with their conversation.]\n\n` +
                excerpt,
            },
          });
          appendLiveMessage({
            role: "system",
            source: "file",
            content: `Accepted file \"${file.name}\". Kabir has it in this session's context.`,
          });
          await fetch(`/api/session/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              appendContext: `[File shared during session: ${file.name}]\n${String(excerpt).slice(0, 4000)}`,
              appendTranscriptEntry: {
                role: "user",
                source: "file",
                time: new Date().toISOString(),
                content: `[Shared file: ${file.name}]`,
              },
            }),
          });
          setAttachStatus("done");
          trackEvent("attachment_upload_succeeded", {
            source: "session",
            session_id: id,
            file_name: file.name,
          });
          setTimeout(() => setAttachStatus("idle"), 3000);
        }
      } catch (err) {
        console.error("File upload failed:", err);
        trackEvent("attachment_upload_failed", {
          source: "session",
          session_id: id,
          status: 0,
          error: "network_or_unknown",
        });
        setAttachError("Upload failed. Please try a smaller file.");
        setAttachStatus("idle");
      }

      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [id, appendLiveMessage, markUserActivity]
  );

  const endSession = useCallback(async (reason: "manual" | "silence_auto" | "user_voice_request" = "manual") => {
    if (endingRef.current) return;
    endingRef.current = true;
    trackEvent("session_end_clicked", {
      session_id: id,
      speaking_state: speaking,
      elapsed_seconds: elapsed,
      end_reason: reason,
    });
    setEnding(true);
    setSpeaking("idle");

    if (vapiRef.current) vapiRef.current.stop();
    setStatus("ended");
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const res = await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: id,
          vapiCallId: callIdRef.current,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        const reason = data.error || `HTTP ${res.status}`;
        throw new Error(reason);
      }

      trackEvent("session_end_succeeded", {
        session_id: id,
        end_reason: reason,
      });

      sessionStorage.removeItem(`spar_session_${id}`);
      setEnding(false);
      setStatus("feedback");
    } catch (error) {
      console.error("End session failed:", error);
      trackEvent("session_end_failed", {
        session_id: id,
        end_reason: reason,
        error: error instanceof Error ? error.message : "unknown",
      });
      endingRef.current = false;
      setEnding(false);
      setStatus("error");
      setErrorMsg(
        `Could not end this session: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }, [id, speaking, elapsed]);

  useEffect(() => {
    endSessionRef.current = endSession;
  }, [endSession]);

  const continueToNotes = useCallback(() => {
    if (!id) return;
    router.push(`/notes/${id}`);
  }, [id, router]);

  const submitFeedback = useCallback(async () => {
    if (!id) return;

    if (!callRating) {
      setFeedbackError("Please rate the call out of 5 stars.");
      return;
    }

    if (!recommendScore) {
      setFeedbackError("Please share how likely you are to recommend Kabir (1-10).");
      return;
    }

    setFeedbackError(null);
    setFeedbackSaving(true);

    trackEvent("session_feedback_submit_started", {
      session_id: id,
      call_rating: callRating,
      csat_recommend_score: recommendScore,
      has_written_feedback: callFeedback.trim().length > 0,
    });

    try {
      const res = await fetch(`/api/session/${id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_rating: callRating,
          csat_recommend_score: recommendScore,
          call_feedback: callFeedback.trim() || null,
          source: "end_call",
          metadata: {
            elapsed_seconds: elapsed,
            vapi_call_id: callIdRef.current,
          },
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      trackEvent("session_feedback_submit_succeeded", {
        session_id: id,
        call_rating: callRating,
        csat_recommend_score: recommendScore,
      });

      continueToNotes();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not save feedback";
      setFeedbackError(msg);
      trackEvent("session_feedback_submit_failed", {
        session_id: id,
        error: msg,
      });
    } finally {
      setFeedbackSaving(false);
    }
  }, [id, callRating, recommendScore, callFeedback, elapsed, continueToNotes]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const saveMidSessionContext = useCallback(async () => {
    if (!id || !midContextDraft.trim()) return;
    setMidContextSaving(true);
    setMidContextSaved(false);
    try {
      const draft = midContextDraft.trim();
      setMidContextDraft("");
      markUserActivity();
      const vapi = vapiRef.current;
      if (vapi) {
        vapi.send({
          type: "add-message",
          triggerResponseEnabled: true,
          message: {
            role: "user",
            content: draft,
          },
        });
      }
      appendLiveMessage({ role: "user", source: "typed", content: draft });
      const res = await fetch(`/api/session/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appendContext: draft,
          appendTranscriptEntry: {
            role: "user",
            content: draft,
            source: "typed",
            time: new Date().toISOString(),
          },
        }),
      });
      if (res.ok) {
        setMidContextSaved(true);
        window.setTimeout(() => setMidContextSaved(false), 4000);
      } else {
        // Restore unsaved draft if persistence failed.
        setMidContextDraft(draft);
      }
    } finally {
      setMidContextSaving(false);
    }
  }, [id, midContextDraft, appendLiveMessage, markUserActivity]);

  if (status === "error") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <p className="text-sm text-red-400">{errorMsg}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-4 text-sm text-slate-400 transition-colors hover:text-white"
        >
          Back
        </button>
      </div>
    );
  }

  if (status === "ended") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center text-center">
        <p className="text-sm text-slate-300">Kabir is writing his notes...</p>
        <div className="mt-4 flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-500"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === "feedback") {
    return (
      <div className="mx-auto flex min-h-[80vh] w-full max-w-2xl flex-col items-center justify-center px-5 py-8">
        <div className="w-full rounded-2xl border border-slate-700/60 bg-slate-950/60 p-6 sm:p-7">
          <h1 className="text-center text-xl font-semibold text-slate-100">
            Before you go, quick feedback
          </h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            This helps us log call quality and improve Kabir.
          </p>

          <section className="mt-6">
            <p className="text-sm font-medium text-slate-200">How was the call?</p>
            <div className="mt-2 flex items-center gap-2">
              {Array.from({ length: 5 }).map((_, idx) => {
                const value = idx + 1;
                const active = (callRating || 0) >= value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Rate ${value} out of 5`}
                    onClick={() => setCallRating(value)}
                    className={`rounded-md p-1.5 transition-colors ${
                      active ? "text-amber-300" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    <Star className={`h-7 w-7 ${active ? "fill-current" : ""}`} />
                  </button>
                );
              })}
              <span className="ml-2 text-xs text-slate-400">
                {callRating ? `${callRating}/5` : "Select 1 to 5"}
              </span>
            </div>
          </section>

          <section className="mt-6">
            <p className="text-sm font-medium text-slate-200">
              How likely are you to recommend Kabir to your friends?
            </p>
            <p className="mt-1 text-xs text-slate-500">1 = not likely, 10 = very likely</p>
            <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {Array.from({ length: 10 }).map((_, idx) => {
                const value = idx + 1;
                const selected = recommendScore === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRecommendScore(value)}
                    className={`rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                      selected
                        ? "border-cyan-400/70 bg-cyan-500/15 text-cyan-100"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-6">
            <label htmlFor="call-feedback" className="text-sm font-medium text-slate-200">
              Anything else we should know? (optional)
            </label>
            <textarea
              id="call-feedback"
              rows={4}
              value={callFeedback}
              onChange={(e) => setCallFeedback(e.target.value)}
              maxLength={2000}
              placeholder="What worked, what felt off, what to improve..."
              className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-500"
            />
          </section>

          {feedbackError ? (
            <p className="mt-3 text-sm text-red-400" role="alert">
              {feedbackError}
            </p>
          ) : null}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => void submitFeedback()}
              disabled={feedbackSaving}
              className="rounded-md border border-emerald-500/60 bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
            >
              {feedbackSaving ? "Saving..." : "Submit & continue"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "trust" && id) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <p className="max-w-sm text-sm leading-relaxed text-slate-200">
          This conversation stays between you and Kabir.
        </p>
        <button
          type="button"
          onClick={() => setTrustAcknowledged(true)}
          className="mt-8 rounded border border-emerald-600/60 bg-emerald-600/15 px-6 py-3 text-sm font-medium text-emerald-100 hover:bg-emerald-600/25"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div
      data-session-page="true"
      className="flex min-h-[80vh] flex-col items-center justify-center pb-[min(34rem,58vh)] sm:pb-[min(30rem,50vh)]"
    >
      {status === "connecting" && (
        <div className="text-center">
          <div className="mb-4 flex justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-500"
                style={{ animationDelay: `${i * 0.3}s` }}
              />
            ))}
          </div>
          <p className="text-sm text-slate-400">Connecting to Kabir...</p>
        </div>
      )}

      {status === "active" && (
        <>
          <div className="mb-5 flex items-center gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`w-0.5 rounded-full transition-all duration-300 ${
                  speaking === "kabir"
                    ? "animate-waveform bg-emerald-500/60"
                    : "bg-slate-600"
                }`}
                style={{
                  height: speaking === "kabir" ? `${20 + (i % 3) * 7}px` : "10px",
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>

          <p className="text-base font-medium text-slate-300">
            {speaking === "kabir" ? "Kabir is speaking..." : "Listening..."}
          </p>

          <p className="mt-2 font-mono text-sm text-slate-400">
            {formatTime(elapsed)}
          </p>
          {contextSummary ? (
            <p className="mt-2 text-center text-[11px] text-emerald-300/85">
              Context loaded: {contextSummary.contextChars || 0} chars
              {Array.isArray(contextSummary.files) && contextSummary.files.length > 0
                ? `, ${contextSummary.files.length} file${contextSummary.files.length === 1 ? "" : "s"}`
                : ""}
            </p>
          ) : null}
          {capHint ? (
            <p className="mt-2 text-xs text-cyan-300/80">{capHint}</p>
          ) : null}
          {silenceBanner ? (
            <p className="mt-2 text-xs text-amber-300/90">{silenceBanner}</p>
          ) : null}

          {liveMessages.length > 0 ? (
            <div className="mt-5 w-[min(100vw-1.25rem,46rem)] rounded-xl border border-slate-700/60 bg-slate-950/55 px-3 py-3 backdrop-blur">
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                <MessageSquareText className="h-3.5 w-3.5" />
                Conversation log
              </div>
              <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                {liveMessages.slice(-8).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border px-2.5 py-2 text-xs leading-relaxed ${
                      m.role === "assistant"
                        ? "border-cyan-700/50 bg-cyan-950/20 text-slate-100"
                        : m.role === "user"
                          ? "border-emerald-700/50 bg-emerald-950/20 text-slate-100"
                          : "border-amber-700/50 bg-amber-950/20 text-slate-100"
                    }`}
                  >
                    <span
                      className={`mr-2 uppercase tracking-wider ${
                        m.role === "assistant"
                          ? "text-cyan-300"
                          : m.role === "user"
                            ? "text-emerald-300"
                            : "text-amber-300"
                      }`}
                    >
                      {m.role === "assistant" ? "Kabir" : m.role === "user" ? "You" : "System"}
                    </span>
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="fixed bottom-0 left-1/2 z-40 w-[min(100vw-0.75rem,44rem)] -translate-x-1/2 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/95 p-3 shadow-lg backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <textarea
                  value={midContextDraft}
                  onFocus={() => {
                    setComposerFocused(true);
                    markUserActivity();
                  }}
                  onBlur={() => setComposerFocused(false)}
                  onChange={(e) => {
                    setMidContextDraft(e.target.value);
                    markUserActivity();
                  }}
                  onKeyDown={(e) => {
                    markUserActivity();
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveMidSessionContext();
                    }
                  }}
                  placeholder="Message Kabir with extra context..."
                  rows={2}
                  className="max-h-32 min-h-[44px] w-full flex-1 resize-y rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-cyan-500/50"
                />
                <button
                  type="button"
                  disabled={midContextSaving || !midContextDraft.trim()}
                  onClick={() => void saveMidSessionContext()}
                  className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-cyan-600 px-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 sm:w-auto"
                >
                  {midContextSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send
                </button>
              </div>
              <div className="mt-3 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={attachStatus === "processing"}
                  title="Add a file to context"
                  className="inline-flex w-full min-w-[10rem] items-center justify-center gap-2 rounded-full border border-slate-600/60 bg-slate-900/50 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-cyan-500/40 hover:bg-slate-800/60 disabled:opacity-50 sm:w-auto"
                >
                  {attachStatus === "processing" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : attachStatus === "done" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5" />
                  )}
                  {attachStatus === "processing"
                    ? "Processing…"
                    : attachStatus === "done"
                      ? "Sent to Kabir"
                      : "Add file to context"}
                </button>
                <button
                  type="button"
                  onClick={() => void endSession("manual")}
                  disabled={ending}
                  className="w-full rounded-full bg-rose-500/90 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
                >
                  {ending ? "Ending…" : "End session"}
                </button>
              </div>
              {midContextSaved ? (
                <p className="mt-2 text-center text-[10px] text-emerald-500/90">
                  Sent. Saved to this session for notes and memory.
                </p>
              ) : (
                <p className="mt-2 text-center text-[10px] leading-snug text-slate-500">
                  Type to Kabir anytime; files upload as text for him to use.
                </p>
              )}
            </div>
          </div>

          {attachError ? (
            <p className="fixed bottom-[13.2rem] left-1/2 z-40 max-w-md -translate-x-1/2 px-4 text-center text-xs text-red-400 sm:bottom-[11.8rem]">
              {attachError}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
