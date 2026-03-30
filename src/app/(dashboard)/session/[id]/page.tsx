"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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

/** Idle seconds: first nudge → second nudge → auto-end (30s total silence cap). */
const SILENCE_NUDGE_1_SECONDS = 10;
const SILENCE_NUDGE_2_SECONDS = 20;
const SILENCE_AUTO_END_SECONDS = 30;

const LOCAL_MIC_ACTIVITY_THRESHOLD = 0.035;

function isUserTranscriptRole(role: string): boolean {
  const r = role.toLowerCase();
  return (
    r.includes("user") ||
    r.includes("customer") ||
    r.includes("caller") ||
    r.includes("client") ||
    r.includes("human") ||
    r === "participant" ||
    r === "member"
  );
}

function extractSideChannelUserText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const o = payload as Record<string, unknown>;
  const tryText = (x: unknown) =>
    typeof x === "string" && x.trim() ? x.trim() : null;
  const t = typeof o.type === "string" ? o.type.toLowerCase() : "";
  if (t.includes("transcript") || t === "conversation-update") {
    const role = typeof o.role === "string" ? o.role : "";
    if (isUserTranscriptRole(role)) {
      return (
        tryText(o.transcript) ||
        tryText(o.text) ||
        tryText(o.content) ||
        tryText(o.message)
      );
    }
  }
  const transcript = o.transcript;
  if (typeof transcript === "object" && transcript !== null) {
    const tr = transcript as Record<string, unknown>;
    const role = typeof tr.role === "string" ? tr.role : "";
    if (isUserTranscriptRole(role)) {
      return tryText(tr.text) || tryText(tr.content) || tryText(tr.transcript);
    }
  }
  return null;
}

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

function readStringField(
  obj: Record<string, unknown> | undefined,
  keys: string[]
): string {
  if (!obj) return "";
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
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
  /** Last time we heard the user (transcript, mic, typed, file, composer). */
  const lastUserSoundRef = useRef(Date.now());
  /** Last time assistant audio went quiet (speech-end); silence counts from max(user, assistant). */
  const lastAssistantQuietRef = useRef(Date.now());
  /** 0 = no nudge yet, 1 = first nudge sent, 2 = second nudge sent, 3 = ended */
  const silenceStageRef = useRef(0);
  const autoEndedForSilenceRef = useRef(false);
  const pendingEndConfirmUntilRef = useRef<number | null>(null);
  const endSessionRef = useRef<
    ((reason?: "manual" | "silence_auto" | "user_voice_request") => Promise<void>) | null
  >(null);
  /** Live row id for in-place updates of streaming Vapi `transcript` partials. */
  const assistantVoiceStreamIdRef = useRef<string | null>(null);
  const userVoiceStreamIdRef = useRef<string | null>(null);

  const appendLiveMessage = useCallback((message: Omit<LiveMessage, "id">) => {
    setLiveMessages((prev) => [
      ...prev.slice(-39),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...message,
      },
    ]);
  }, []);

  /**
   * Vapi sends many `transcript` events with transcriptType partial then final.
   * Update one bubble per role until final; avoids duplicate "KabirIf…" lines.
   */
  const upsertVoiceTranscriptLine = useCallback(
    (role: "assistant" | "user", content: string, isFinal: boolean) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const streamRef =
        role === "assistant" ? assistantVoiceStreamIdRef : userVoiceStreamIdRef;

      setLiveMessages((prev) => {
        const sid = streamRef.current;
        if (sid) {
          const idx = prev.findIndex((m) => m.id === sid);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], content: trimmed };
            if (isFinal) streamRef.current = null;
            return next;
          }
          streamRef.current = null;
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        if (!isFinal) streamRef.current = id;
        const capped = prev.length >= 40 ? prev.slice(-39) : prev;
        return [...capped, { id, role, source: "voice", content: trimmed }];
      });
    },
    []
  );

  const registerAssistantQuiet = useCallback(() => {
    lastAssistantQuietRef.current = Date.now();
  }, []);

  const registerUserSound = useCallback(() => {
    lastUserSoundRef.current = Date.now();
    silenceStageRef.current = 0;
    autoEndedForSilenceRef.current = false;
    setSilenceBanner(null);
  }, []);

  const initSilenceClock = useCallback(() => {
    const t = Date.now();
    lastUserSoundRef.current = t;
    lastAssistantQuietRef.current = t;
    silenceStageRef.current = 0;
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
      assistantVoiceStreamIdRef.current = null;
      userVoiceStreamIdRef.current = null;
      setStatus("active");
      initSilenceClock();
      try {
        await vapi.increaseMicLevel(1.15);
      } catch {
        /* noop */
      }
      const daily = (
        vapi as unknown as {
          call?: { on?: (ev: string, fn: (e: unknown) => void) => void };
        }
      ).call;
      daily?.on?.("local-audio-level", (ev: unknown) => {
        const level =
          ev && typeof ev === "object" && "audioLevel" in ev
            ? Number((ev as { audioLevel: number }).audioLevel)
            : 0;
        if (level > LOCAL_MIC_ACTIVITY_THRESHOLD) {
          lastUserSoundRef.current = Date.now();
          silenceStageRef.current = 0;
          autoEndedForSilenceRef.current = false;
          setSilenceBanner(null);
        }
      });
    });
    vapi.on("call-end", () => {
      setStatus("ended");
      if (timerRef.current) clearInterval(timerRef.current);
    });

    vapi.on("speech-start", () => {
      setSpeaking("kabir");
    });
    vapi.on("speech-end", () => {
      setSpeaking("listening");
      registerAssistantQuiet();
    });

    vapi.on("message", (payload: unknown) => {
      const top = (payload || {}) as Record<string, unknown>;
      const body = (top.message || undefined) as Record<string, unknown> | undefined;
      const merged = { ...top, ...(body || {}) } as Record<string, unknown>;

      const msgType = typeof merged.type === "string" ? merged.type : "";
      if (msgType === "transcript" || msgType.startsWith("transcript[")) {
        const tr =
          typeof merged.transcript === "string" ? merged.transcript.trim() : "";
        if (!tr) return;

        const tType =
          merged.transcriptType === "partial" || merged.transcriptType === "final"
            ? merged.transcriptType
            : "final";
        const isFinal = tType === "final";

        const roleRawTr =
          typeof merged.role === "string" ? merged.role.toLowerCase() : "";

        if (
          roleRawTr === "assistant" ||
          roleRawTr === "bot" ||
          roleRawTr === "agent"
        ) {
          upsertVoiceTranscriptLine("assistant", tr, isFinal);
          return;
        }

        if (isUserTranscriptRole(roleRawTr)) {
          registerUserSound();
          upsertVoiceTranscriptLine("user", tr, isFinal);

          if (isFinal) {
            const now = Date.now();
            const pendingUntil = pendingEndConfirmUntilRef.current;
            const withinConfirmWindow = Boolean(pendingUntil && now < pendingUntil);

            if (withinConfirmWindow && hasEndConfirmation(tr) && !endingRef.current) {
              pendingEndConfirmUntilRef.current = null;
              setSilenceBanner("Confirmed. Ending this session now.");
              void endSessionRef.current?.("user_voice_request");
              return;
            }

            if (hasNegatedEndIntent(tr)) {
              pendingEndConfirmUntilRef.current = null;
              setSilenceBanner("Okay, I will not end right now.");
              return;
            }

            if (hasEndIntent(tr) && !endingRef.current) {
              if (
                hasImmediateEndIntent(tr) ||
                (withinConfirmWindow && hasEndConfirmation(tr))
              ) {
                pendingEndConfirmUntilRef.current = null;
                setSilenceBanner("Heard you. Ending this session now.");
                void endSessionRef.current?.("user_voice_request");
                return;
              }

              if (hasSpecificSessionEndIntent(tr)) {
                pendingEndConfirmUntilRef.current = null;
                setSilenceBanner("Heard you. Ending this session now.");
                void endSessionRef.current?.("user_voice_request");
                return;
              }

              pendingEndConfirmUntilRef.current = now + 12000;
              setSilenceBanner(
                "Say 'end session now' to confirm, or keep talking to continue."
              );
              const vapiLocal = vapiRef.current;
              if (vapiLocal) {
                vapiLocal.send({
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
        }
        return;
      }

      const roleRaw =
        readStringField(body, ["role", "speaker", "from"]) ||
        readStringField(top, ["role", "speaker", "from"]);
      const role = roleRaw.toLowerCase();

      const textFromRow =
        readStringField(body, ["content", "message", "text", "transcript"]) ||
        readStringField(top, ["content", "message", "text", "transcript"]);
      const sideFallback = textFromRow ? null : extractSideChannelUserText(payload);
      const text = (textFromRow || sideFallback || "").trim();
      if (!text) return;

      if (
        textFromRow &&
        (role.includes("assistant") || role.includes("bot") || role.includes("agent"))
      ) {
        appendLiveMessage({ role: "assistant", source: "voice", content: text });
        return;
      }

      const likelyUserTranscript =
        !role &&
        (String(top.type || "").toLowerCase().includes("transcript") ||
          String(body?.type || "").toLowerCase().includes("transcript"));

      const isUserLine =
        Boolean(sideFallback) ||
        (Boolean(textFromRow) && isUserTranscriptRole(role)) ||
        role.includes("user") ||
        role.includes("customer") ||
        likelyUserTranscript;

      if (isUserLine) {
        registerUserSound();
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
          const vapiLocal = vapiRef.current;
          if (vapiLocal) {
            vapiLocal.send({
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
          // Slightly longer pause so Kabir doesn't jump in while you're mid-thought.
          waitSeconds: 1.15,
          smartEndpointingPlan: { provider: "livekit" },
        },
        stopSpeakingPlan: {
          // numWords: 0 → use VAD (voiceSeconds) so he stops as soon as you talk, not after 2 words.
          numWords: 0,
          voiceSeconds: 0.14,
          backoffSeconds: 0.45,
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
    upsertVoiceTranscriptLine,
    initSilenceClock,
    registerUserSound,
    registerAssistantQuiet,
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
        registerUserSound();
        return;
      }
      const idleStart = Math.max(
        lastUserSoundRef.current,
        lastAssistantQuietRef.current
      );
      const idleSeconds = (Date.now() - idleStart) / 1000;
      const vapi = vapiRef.current;

      if (
        idleSeconds >= SILENCE_NUDGE_1_SECONDS &&
        silenceStageRef.current === 0
      ) {
        silenceStageRef.current = 1;
        setSilenceBanner(
          "Still there? Another 20 seconds of silence and we’ll wrap."
        );
        if (vapi) {
          vapi.send({
            type: "add-message",
            triggerResponseEnabled: true,
            message: {
              role: "system",
              content:
                "The user has been quiet ~10 seconds after you spoke. Give ONE short, warm check-in (one sentence). Mention you’ll need to end the session if they’re still quiet for about 20 more seconds (30 seconds total silence).",
            },
          });
        }
      }

      if (
        idleSeconds >= SILENCE_NUDGE_2_SECONDS &&
        silenceStageRef.current === 1
      ) {
        silenceStageRef.current = 2;
        setSilenceBanner("Last check — wrapping in ~10 seconds if it stays quiet.");
        if (vapi) {
          vapi.send({
            type: "add-message",
            triggerResponseEnabled: true,
            message: {
              role: "system",
              content:
                "Still silence ~20 seconds. One more very brief nudge (single sentence). If no reply, you’ll stop — the session auto-ends at 30 seconds of silence total.",
            },
          });
        }
      }

      if (
        idleSeconds >= SILENCE_AUTO_END_SECONDS &&
        !autoEndedForSilenceRef.current
      ) {
        autoEndedForSilenceRef.current = true;
        silenceStageRef.current = 3;
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
    registerUserSound,
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
          registerUserSound();
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
    [id, appendLiveMessage, registerUserSound]
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
        `something broke wrapping up: ${error instanceof Error ? error.message : "unknown"}`
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
      setFeedbackError("quick — rate the call (1–5) so kabir knows how it felt.");
      return;
    }

    if (!recommendScore) {
      setFeedbackError("slide the recommend score (1–10). helps us tune him.");
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
      const msg = error instanceof Error ? error.message : "couldn't save that. try again?";
      setFeedbackError(msg);
      trackEvent("session_feedback_submit_failed", {
        session_id: id,
        error: msg,
      });
    } finally {
      setFeedbackSaving(false);
    }
  }, [id, callRating, recommendScore, callFeedback, elapsed, continueToNotes]);

  /** Hide internal silence-control lines from the live transcript. */
  const transcriptForDisplay = useMemo(
    () =>
      liveMessages.filter(
        (m) =>
          !(
            m.role === "system" &&
            m.source === "status" &&
            /silence/i.test(m.content)
          )
      ),
    [liveMessages]
  );

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
      registerUserSound();
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
  }, [id, midContextDraft, appendLiveMessage, registerUserSound]);

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
        <p className="text-sm text-slate-300">kabir&apos;s writing his notes…</p>
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
                      active ? "text-cyan-300" : "text-slate-500 hover:text-slate-300"
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
              aria-busy={feedbackSaving}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/60 bg-emerald-600/20 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-600/30 disabled:opacity-50"
            >
              {feedbackSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {feedbackSaving ? "Saving…" : "Submit & continue"}
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
          <p className="text-sm text-slate-400">connecting…</p>
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
            <p className="mt-2 text-xs text-cyan-300/90">{silenceBanner}</p>
          ) : null}

          <div className="mt-5 w-[min(100vw-1.25rem,46rem)] rounded-xl border border-slate-700/60 bg-slate-950/55 px-3 py-3 backdrop-blur">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <MessageSquareText className="h-3.5 w-3.5" />
              Live transcript
            </div>
            <div className="max-h-[min(50vh,22rem)] min-h-[7.5rem] space-y-2 overflow-y-auto pr-1">
              {transcriptForDisplay.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs leading-relaxed text-slate-500">
                  Your lines appear here as they are transcribed. Type below anytime — Kabir gets it as chat and can reply out loud.
                </p>
              ) : (
                transcriptForDisplay.slice(-40).map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border px-2.5 py-2 text-sm leading-relaxed ${
                      m.role === "assistant"
                        ? "border-cyan-700/50 bg-cyan-950/20 text-slate-100"
                        : m.role === "user"
                          ? "border-emerald-700/50 bg-emerald-950/20 text-slate-100"
                          : "border-slate-600/50 bg-slate-900/40 text-slate-200"
                    }`}
                  >
                    <span
                      className={`mb-1 block text-[10px] uppercase tracking-wider ${
                        m.role === "assistant"
                          ? "text-cyan-300"
                          : m.role === "user"
                            ? "text-emerald-300"
                            : "text-slate-400"
                      }`}
                    >
                      {m.role === "assistant"
                        ? "Kabir"
                        : m.role === "user"
                          ? m.source === "typed"
                            ? "You (typed)"
                            : "You"
                          : "Note"}
                    </span>
                    <span className="block whitespace-pre-wrap">{m.content}</span>
                  </div>
                ))
              )}
            </div>
          </div>

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
                    registerUserSound();
                  }}
                  onBlur={() => setComposerFocused(false)}
                  onChange={(e) => {
                    setMidContextDraft(e.target.value);
                    registerUserSound();
                  }}
                  onKeyDown={(e) => {
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
                  aria-busy={midContextSaving}
                  className="inline-flex h-11 min-w-[6.5rem] shrink-0 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 sm:w-auto"
                >
                  {midContextSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send
                    </>
                  )}
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
