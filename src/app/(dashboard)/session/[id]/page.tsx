"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Paperclip, Loader2, Check } from "lucide-react";
import Vapi from "@vapi-ai/web";
import { trackEvent } from "@/lib/analytics";

type SessionStatus =
  | "trust"
  | "connecting"
  | "active"
  | "ended"
  | "error";
type SpeakingState = "listening" | "kabir" | "idle";

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
    };
    const { systemPrompt, firstMessage } = parsed;

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
        maxDurationSeconds: 600,
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

        if (data.text && vapiRef.current) {
          vapiRef.current.send({
            type: "add-message",
            message: {
              role: "system",
              content: `[The user just shared a file: "${file.name}"]\n\nHere is the content:\n${data.text}\n\nAcknowledge that you received it and reference any relevant content naturally in the conversation.`,
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
      setTimeout(() => router.push(`/notes/${id}`), 2500);
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
  }, [id, router, speaking, elapsed]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="fixed bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-6 rounded-full border border-slate-700/60 bg-slate-950/70 px-4 py-2 backdrop-blur">
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

            <button
              onClick={endSession}
              disabled={ending}
              className="rounded bg-rose-500/85 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {ending ? "Ending..." : "End session"}
            </button>
          </div>

          {attachError ? (
            <p className="fixed bottom-14 left-1/2 -translate-x-1/2 text-center text-xs text-red-400">
              {attachError}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
