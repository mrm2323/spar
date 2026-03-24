"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Paperclip, Loader2, Check, Monitor, Square, Star } from "lucide-react";
import Vapi from "@vapi-ai/web";
import { startPracticeReplaySession, trackEvent } from "@/lib/analytics";

type SessionStatus =
  | "trust"
  | "connecting"
  | "active"
  | "ended"
  | "feedback"
  | "error";
type SpeakingState = "listening" | "kabir" | "idle";

function isUserCancelledDisplayMedia(e: unknown): boolean {
  const d = e as { name?: string };
  return d?.name === "NotAllowedError" || d?.name === "AbortError";
}

/** Wait until the screen-capture video element has drawable frames (or timeout). */
function waitUntilVideoHasSize(
  video: HTMLVideoElement,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const ok = () =>
      video.videoWidth >= 2 &&
      video.videoHeight >= 2 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (ok()) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(tid);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("resize", onReady);
      resolve(result);
    };
    const onReady = () => {
      if (ok()) finish(true);
    };
    const tid = window.setTimeout(() => finish(false), timeoutMs);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("playing", onReady);
  });
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Prevents overlapping getDisplayMedia (double-clicks / picker still open). */
  const screenShareStartingRef = useRef(false);
  /** Abort in-flight screen-context fetch when user stops sharing or cancels. */
  const screenCaptureAbortRef = useRef<AbortController | null>(null);
  /** Bumps when a new capture starts or sharing stops — stale async work must not touch UI. */
  const screenCaptureGenerationRef = useRef(0);
  const [screenSharing, setScreenSharing] = useState(false);
  /** True while permission picker is open or stream is wiring up */
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [screenStatus, setScreenStatus] = useState<
    "idle" | "processing" | "done"
  >("idle");
  const [screenError, setScreenError] = useState<string | null>(null);
  const [capHint, setCapHint] = useState<string | null>(null);
  const [callRating, setCallRating] = useState<number | null>(null);
  const [recommendScore, setRecommendScore] = useState<number | null>(null);
  const [callFeedback, setCallFeedback] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [midContextDraft, setMidContextDraft] = useState("");
  const [midContextSaving, setMidContextSaving] = useState(false);
  const [midContextSaved, setMidContextSaved] = useState(false);
  const replayStartSentRef = useRef(false);

  useEffect(() => {
    if (!id || replayStartSentRef.current) return;
    replayStartSentRef.current = true;
    startPracticeReplaySession({
      source: "session_page_mount",
      session_id: id,
    });
  }, [id]);

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
    };
    const { systemPrompt, firstMessage } = parsed;

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

    vapi.on("speech-start", () => setSpeaking("kabir"));
    vapi.on("speech-end", () => setSpeaking("listening"));

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
          waitSeconds: 0.3,
          smartEndpointingEnabled: true,
        },
        stopSpeakingPlan: {
          numWords: 1,
          voiceSeconds: 0.08,
          backoffSeconds: 0.35,
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
  }, [id, router, trustAcknowledged]);

  useEffect(() => {
    if (status === "active") {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

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
    [id]
  );

  const stopScreenShare = useCallback(() => {
    screenCaptureGenerationRef.current += 1;
    screenCaptureAbortRef.current?.abort();
    screenCaptureAbortRef.current = null;
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScreenSharing(false);
    setScreenStatus("idle");
    screenShareStartingRef.current = false;
    setScreenShareBusy(false);
  }, []);

  const captureAndSendScreen = useCallback(async () => {
    screenCaptureGenerationRef.current += 1;
    const generation = screenCaptureGenerationRef.current;
    const ac = new AbortController();
    screenCaptureAbortRef.current?.abort();
    screenCaptureAbortRef.current = ac;

    // Clear any stuck "Reading screen…" from a superseded capture.
    setScreenStatus("idle");

    const video = videoRef.current;
    const vapi = vapiRef.current;
    if (!video || !vapi) {
      return;
    }

    const hasSize = await waitUntilVideoHasSize(video, 6000);
    if (generation !== screenCaptureGenerationRef.current) return;
    if (
      !hasSize ||
      video.videoWidth < 2 ||
      video.videoHeight < 2
    ) {
      return;
    }

    if (generation !== screenCaptureGenerationRef.current) return;

    setScreenError(null);
    setScreenStatus("processing");

    const fetchTimeoutMs = 90_000;
    const fetchTimeoutId = window.setTimeout(() => ac.abort(), fetchTimeoutMs);

    try {
      const maxW = 1280;
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      const base64 = dataUrl.split(",")[1];
      if (!base64) throw new Error("empty frame");

      if (generation !== screenCaptureGenerationRef.current) return;

      const res = await fetch("/api/screen-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: "image/jpeg",
        }),
        signal: ac.signal,
      });
      const data = await res.json();

      if (generation !== screenCaptureGenerationRef.current) return;

      if (!res.ok) {
        setScreenError(
          typeof data.error === "string" ? data.error : "Screen capture failed"
        );
        setScreenStatus("idle");
        return;
      }
      const description = String(data.description || "").trim();
      if (!description) {
        setScreenError("Could not read your screen.");
        setScreenStatus("idle");
        return;
      }

      const excerpt =
        description.length > 8000
          ? `${description.slice(0, 8000)}\n[Truncated]`
          : description;

      vapi.send({
        type: "add-message",
        triggerResponseEnabled: true,
        message: {
          role: "user",
          content:
            `[The user is sharing their screen with you. Here is what is visible right now — use it as context for coaching; do not read it aloud unless it helps.]\n\n${excerpt}`,
        },
      });
      setScreenStatus("done");
      trackEvent("screen_context_sent", { session_id: id });
      setTimeout(() => {
        if (generation === screenCaptureGenerationRef.current) {
          setScreenStatus("idle");
        }
      }, 2500);
    } catch (e) {
      if (generation !== screenCaptureGenerationRef.current) return;
      const err = e as { name?: string };
      if (err?.name === "AbortError") {
        setScreenStatus("idle");
        return;
      }
      console.error("Screen capture failed:", e);
      setScreenError("Could not send screen.");
      setScreenStatus("idle");
    } finally {
      clearTimeout(fetchTimeoutId);
      if (screenCaptureAbortRef.current === ac) {
        screenCaptureAbortRef.current = null;
      }
    }
  }, [id]);

  const startScreenShare = useCallback(async () => {
    if (!vapiRef.current) return;
    if (screenShareStartingRef.current) return;

    screenShareStartingRef.current = true;
    setScreenShareBusy(true);
    setScreenError(null);

    try {
      // `video: true` keeps the picker offering full screen, window, and tab across browsers.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      screenStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => stopScreenShare();
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => {});

      setScreenSharing(true);

      // First capture after frames are available (handled inside captureAndSendScreen).
      window.setTimeout(() => void captureAndSendScreen(), 400);

      if (screenIntervalRef.current) clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = setInterval(() => {
        void captureAndSendScreen();
      }, 45_000);
    } catch (e) {
      console.error("getDisplayMedia:", e);
      stopScreenShare();
      if (isUserCancelledDisplayMedia(e)) {
        setScreenError(
          "You closed the picker — tap Share screen whenever you want to try again."
        );
        window.setTimeout(() => {
          setScreenError((prev) =>
            prev?.includes("closed the picker") ? null : prev
          );
        }, 5000);
      } else {
        setScreenError(
          "Could not start screen sharing. Check browser permissions and try again."
        );
      }
    } finally {
      screenShareStartingRef.current = false;
      setScreenShareBusy(false);
    }
  }, [captureAndSendScreen, stopScreenShare]);

  useEffect(() => {
    return () => {
      stopScreenShare();
    };
  }, [stopScreenShare]);

  const endSession = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    trackEvent("session_end_clicked", {
      session_id: id,
      speaking_state: speaking,
      elapsed_seconds: elapsed,
    });
    setEnding(true);
    setSpeaking("idle");
    stopScreenShare();

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
      });

      sessionStorage.removeItem(`spar_session_${id}`);
      setEnding(false);
      setStatus("feedback");
    } catch (error) {
      console.error("End session failed:", error);
      trackEvent("session_end_failed", {
        session_id: id,
        error: error instanceof Error ? error.message : "unknown",
      });
      endingRef.current = false;
      setEnding(false);
      setStatus("error");
      setErrorMsg(
        `Could not end this session: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  }, [id, speaking, elapsed, stopScreenShare]);

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
      const res = await fetch(`/api/session/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appendContext: midContextDraft.trim() }),
      });
      if (res.ok) {
        setMidContextSaved(true);
        setMidContextDraft("");
        window.setTimeout(() => setMidContextSaved(false), 4000);
      }
    } finally {
      setMidContextSaving(false);
    }
  }, [id, midContextDraft]);

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
    <div className="flex min-h-[80vh] flex-col items-center justify-center">
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
          <video
            ref={videoRef}
            className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
            playsInline
            muted
            aria-hidden
          />
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
          {capHint ? (
            <p className="mt-2 text-xs text-cyan-300/80">{capHint}</p>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="fixed bottom-24 left-1/2 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-full border border-slate-700/60 bg-slate-950/70 px-4 py-2 backdrop-blur">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={attachStatus === "processing"}
              className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-50"
            >
              {attachStatus === "processing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : attachStatus === "done" ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              {attachStatus === "processing"
                ? "Processing..."
                : attachStatus === "done"
                  ? "Sent to Kabir"
                  : "Share a file"}
            </button>

            {!screenSharing ? (
              <button
                type="button"
                onClick={() => void startScreenShare()}
                disabled={screenShareBusy}
                className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-cyan-300 disabled:pointer-events-none disabled:opacity-40"
              >
                <Monitor className="h-3.5 w-3.5" />
                {screenShareBusy ? "Choose a screen…" : "Share screen"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={stopScreenShare}
                  className="flex items-center gap-1.5 text-xs text-rose-300/90 transition-colors hover:text-rose-200"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop screen
                </button>
                <button
                  type="button"
                  onClick={() => void captureAndSendScreen()}
                  disabled={screenStatus === "processing"}
                  className="text-xs text-cyan-400/90 hover:text-cyan-300 disabled:opacity-50"
                >
                  {screenStatus === "processing"
                    ? "Reading screen…"
                    : "Send screen now"}
                </button>
                {screenStatus === "done" ? (
                  <span className="text-[10px] text-emerald-500/90">Sent</span>
                ) : null}
              </>
            )}

            <button
              onClick={endSession}
              disabled={ending}
              className="rounded bg-rose-500/85 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {ending ? "Ending..." : "End session"}
            </button>
          </div>

          <details className="fixed bottom-[7.25rem] left-1/2 z-40 w-[min(100vw-2rem,24rem)] -translate-x-1/2 rounded-lg border border-slate-700/60 bg-slate-950/90 px-3 py-2 shadow-lg backdrop-blur">
            <summary className="cursor-pointer list-none text-center text-xs font-medium text-slate-400 [&::-webkit-details-marker]:hidden">
              Add context
            </summary>
            <div className="mt-3 space-y-2 pb-1">
              <textarea
                value={midContextDraft}
                onChange={(e) => setMidContextDraft(e.target.value)}
                placeholder="Paste more for Kabir — saved for his notes after this call."
                rows={4}
                className="w-full resize-y rounded border border-slate-700/80 bg-slate-900/80 px-2 py-2 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
              />
              <button
                type="button"
                disabled={midContextSaving || !midContextDraft.trim()}
                onClick={() => void saveMidSessionContext()}
                className="w-full rounded bg-slate-800 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-40"
              >
                {midContextSaving ? "Saving…" : "Save for notes"}
              </button>
              {midContextSaved ? (
                <p className="text-center text-[10px] text-emerald-500/90">
                  Saved — Kabir will use this when he writes your notes.
                </p>
              ) : (
                <p className="text-center text-[10px] leading-snug text-slate-500">
                  Kabir can&apos;t change mid-call voice from here. This text is
                  stored on the session for notes.
                </p>
              )}
            </div>
          </details>

          {(attachError || screenError) ? (
            <p className="fixed bottom-14 left-1/2 max-w-md -translate-x-1/2 px-4 text-center text-xs text-red-400">
              {attachError || screenError}
            </p>
          ) : null}
          {screenSharing ? (
            <p className="fixed bottom-28 left-1/2 max-w-sm -translate-x-1/2 px-4 text-center text-[11px] text-slate-500">
              Screen context is sent now and every 45s. Kabir uses it quietly—he
              won&apos;t read your screen aloud unless it helps.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
