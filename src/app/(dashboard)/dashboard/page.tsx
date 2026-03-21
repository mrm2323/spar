"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  Loader2,
  ArrowRight,
  Paperclip,
  X,
  Phone,
  Check,
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

function SessionConfidenceBar({ score }: { score: number | null | undefined }) {
  const p =
    score == null ? 50 : Math.min(100, Math.max(0, score));
  return (
    <div className="relative mt-2 flex h-1.5 w-full max-w-[120px] overflow-hidden rounded-sm">
      <div className="h-full flex-[1] bg-red-500/80" />
      <div className="h-full flex-[1] bg-amber-500/80" />
      <div className="h-full flex-[1] bg-emerald-600/80" />
      <div
        className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white"
        style={{ left: `calc(${p}% - 0.5px)` }}
      />
    </div>
  );
}

interface ProcessedFile {
  name: string;
  text: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [sessions, setSessions] = useState<PastSession[]>([]);
  const [pattern, setPattern] = useState<PatternInsight | null>(null);
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sessions) setSessions(data.sessions);
        if (data.pattern) setPattern(data.pattern);
      })
      .catch(() => {});

    fetch("/api/user/phone")
      .then((r) => r.json())
      .then((data) => {
        if (data.phone) setLinkedPhone(data.phone);
      })
      .catch(() => {});
  }, []);

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
        JSON.stringify({ systemPrompt: data.systemPrompt })
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
          <button
            type="button"
            onClick={startSession}
            disabled={loading}
            className="group relative mx-auto mb-6 flex h-36 w-36 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900/80 transition-colors hover:border-emerald-600/40 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-10 w-10 animate-spin text-zinc-500" />
            ) : (
              <Mic className="h-10 w-10 text-zinc-500 transition-colors group-hover:text-emerald-400" />
            )}
          </button>

          <h1 className="text-2xl font-semibold tracking-tight">
            {loading
              ? "Connecting to Kabir..."
              : "What conversation are you avoiding?"}
          </h1>

          {!loading && (
            <div className="mt-6">
              {!showContext ? (
                <button
                  type="button"
                  onClick={() => setShowContext(true)}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
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
                    className="w-full rounded-lg border border-zinc-800 bg-[#12121A] px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-700"
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
                          className="flex items-center gap-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-1.5 text-xs text-zinc-400"
                        >
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">{f.name}</span>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="ml-auto shrink-0 text-zinc-600 hover:text-zinc-400"
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
                    className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 disabled:opacity-50"
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
      <div className="mt-4 border-t border-zinc-900 pt-10">
        {sessions.length > 0 ? (
          <>
            <h2 className="mb-5 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Your sessions with Kabir
            </h2>
            <div className="space-y-3">
              {sessions.map((session) => (
                <Link
                  key={session.id}
                  href={`/notes/${session.id}`}
                  className="block rounded-lg border border-zinc-800/80 bg-[#12121A] px-4 py-4 transition-colors hover:border-zinc-700"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        {relativeSessionTime(session.ended_at)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-200">
                        {session.notes_preview ||
                          session.context ||
                          "Session"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600" />
                  </div>
                  <SessionConfidenceBar score={session.confidence ?? null} />
                </Link>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-sm leading-relaxed text-zinc-500">
            First time? Tell Kabir what&apos;s coming up. He&apos;s heard it all.
          </p>
        )}
      </div>

      {/* Pattern — 3+ sessions */}
      {pattern && pattern.total_sessions >= 3 && (
        <div className="mt-10 border-t border-zinc-900 pt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Kabir&apos;s pattern
          </h2>
          <div className="rounded-lg border border-zinc-800/80 bg-[#12121A] px-4 py-4 text-sm leading-relaxed text-zinc-300">
            Across {pattern.total_sessions} sessions, Kabir noticed you tend to{" "}
            {pattern.weakness}. Keep practicing — this usually improves fast.
          </div>
        </div>
      )}

      {/* Phone */}
      <div className="mt-10 border-t border-zinc-900 pt-8">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-600">
          <Phone className="h-3 w-3" />
          Call Kabir by phone
        </div>
        {linkedPhone ? (
          <p className="mt-3 text-sm text-zinc-500">
            Your phone{" "}
            <span className="text-zinc-300">{linkedPhone}</span> is linked.
            Phone sessions appear in your list above.
          </p>
        ) : (
          <div className="mt-3">
            <p className="mb-3 text-sm text-zinc-500">
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
                className="flex-1 rounded-lg border border-zinc-800 bg-[#12121A] px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-700"
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
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-600 hover:text-white disabled:opacity-50"
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
    </div>
  );
}
