"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Paperclip, Loader2, Check } from "lucide-react";
import Vapi from "@vapi-ai/web";

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

    const { systemPrompt } = JSON.parse(raw);

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
        firstMessage: "Hey. It's Kabir. What conversation are you looking forward to?",
        maxDurationSeconds: 600,
        startSpeakingPlan: {
          waitSeconds: 0.6,
          smartEndpointingEnabled: true,
        },
        stopSpeakingPlan: {
          numWords: 1,
          voiceSeconds: 0.2,
          backoffSeconds: 1.5,
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

      setAttachStatus("processing");

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/process-attachment", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.text && vapiRef.current) {
          vapiRef.current.send({
            type: "add-message",
            message: {
              role: "system",
              content: `[The user just shared a file: "${file.name}"]\n\nHere is the content:\n${data.text}\n\nAcknowledge that you received it and reference any relevant content naturally in the conversation.`,
            },
          });
          setAttachStatus("done");
          setTimeout(() => setAttachStatus("idle"), 3000);
        }
      } catch (err) {
        console.error("File upload failed:", err);
        setAttachStatus("idle");
      }

      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    []
  );

  const endSession = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;

    if (vapiRef.current) vapiRef.current.stop();
    setStatus("ended");
    if (timerRef.current) clearInterval(timerRef.current);

    await fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: id,
        vapiCallId: callIdRef.current,
      }),
    });

    sessionStorage.removeItem(`spar_session_${id}`);
    setTimeout(() => router.push(`/notes/${id}`), 2500);
  }, [id, router]);

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
          <div className="mb-4 flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={`w-0.5 rounded-full transition-all duration-300 ${
                  speaking === "kabir"
                    ? "animate-waveform bg-emerald-500/60"
                    : "bg-slate-600"
                }`}
                style={{
                  height: speaking === "kabir" ? `${16 + (i % 3) * 6}px` : "8px",
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>

          <p className="text-sm text-slate-400">
            {speaking === "kabir" ? "Kabir is speaking..." : "Listening..."}
          </p>

          <p className="mt-2 font-mono text-xs text-slate-500">
            {formatTime(elapsed)}
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.csv,.json"
            onChange={handleFileUpload}
            className="hidden"
          />

          <div className="fixed bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-6">
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
              className="text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              End session
            </button>
          </div>
        </>
      )}
    </div>
  );
}
