"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mic, Loader2, ArrowRight, Paperclip, X, Phone, Check } from "lucide-react";
import Link from "next/link";

interface PastSession {
  id: string;
  context: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
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
      // Build full context including processed files
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

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    return `${m} min`;
  };

  return (
    <div>
      <div className="flex min-h-[70vh] flex-col items-center justify-center">
        <div className="text-center">
          <button
            onClick={startSession}
            disabled={loading}
            className="group relative mx-auto mb-6 flex h-36 w-36 items-center justify-center rounded-full border-2 border-zinc-800 bg-zinc-900 transition-all hover:border-emerald-500/50 hover:shadow-[0_0_40px_rgba(16,185,129,0.12)] disabled:opacity-50"
          >
            <div className="animate-pulse-slow absolute inset-0 rounded-full bg-emerald-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
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
                  onClick={() => setShowContext(true)}
                  className="text-sm text-zinc-600 transition-colors hover:text-zinc-400"
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
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-zinc-700"
                  />

                  {/* File attachments */}
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
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileProcessing}
                    className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600 transition-colors hover:text-zinc-400 disabled:opacity-50"
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

      {sessions.length > 0 && (
        <div className="border-t border-zinc-800/50 pt-12">
          <h2 className="mb-6 text-xs font-medium uppercase tracking-widest text-zinc-600">
            Past sessions
          </h2>
          <div className="space-y-2">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/notes/${session.id}`}
                className="group flex items-center justify-between rounded-xl border border-zinc-800/30 bg-zinc-900/20 px-5 py-4 transition-all hover:border-zinc-700/50 hover:bg-zinc-900/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-400">
                    {session.context || "Open session"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {session.ended_at
                      ? new Date(session.ended_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                    {session.duration_seconds
                      ? ` · ${formatDuration(session.duration_seconds)}`
                      : ""}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-400" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Phone linking */}
      <div className="border-t border-zinc-800/50 pt-8 pb-12">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-600">
          <Phone className="h-3 w-3" />
          Call Kabir by phone
        </div>
        {linkedPhone ? (
          <p className="mt-3 text-sm text-zinc-500">
            Your phone <span className="text-zinc-300">{linkedPhone}</span> is
            linked. Phone call sessions and notes will appear above.
          </p>
        ) : (
          <div className="mt-3">
            <p className="mb-3 text-sm text-zinc-500">
              Link your phone number so calls to Kabir show up here with notes.
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
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-700"
              />
              <button
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
                    // Refresh sessions to include any retroactively linked phone sessions
                    fetch("/api/sessions")
                      .then((r) => r.json())
                      .then((d) => {
                        if (d.sessions) setSessions(d.sessions);
                      })
                      .catch(() => {});
                  }
                }}
                disabled={phoneSaved}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
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
