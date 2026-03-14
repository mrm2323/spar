"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mic } from "lucide-react";
import { ShareLink } from "./share-link";

interface NotesData {
  overall_score?: number;
  summary?: string;
  what_worked?: string;
  what_to_rethink?: string;
  next_time?: string;
  best_moment?: string;
  worst_moment?: string;
  one_thing_to_fix?: string;
}

export function NotesClient({
  sessionId,
  initialNotes,
  initialDate,
}: {
  sessionId: string;
  initialNotes?: NotesData | null;
  initialDate?: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NotesData | null>(initialNotes || null);
  const [loading, setLoading] = useState(!initialNotes);
  const [message, setMessage] = useState(
    "Kabir is reviewing your conversation..."
  );
  const [attempt, setAttempt] = useState(0);
  const generatingRef = useRef(false);

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
        /* continue to generation */
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

    // Increase delays to give Vapi time to process the transcript
    const delay = attempt === 0 ? 3000 : attempt < 4 ? 5000 : 8000;
    const timer = setTimeout(tryGetNotes, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, attempt, notes]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900">
          <span className="text-2xl font-bold">K</span>
        </div>
        <p className="text-zinc-400">{message}</p>
        <div className="mt-4 flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-600"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
        {attempt > 10 && (
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-6 rounded-full border border-zinc-700 px-5 py-2 text-sm text-zinc-400 hover:text-white"
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

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/dashboard"
        className="mb-10 inline-flex items-center gap-2 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </Link>

      <h1 className="text-lg font-semibold tracking-tight">
        Kabir&apos;s Notes
      </h1>
      <p className="mt-1 text-xs text-zinc-600">
        {typeof dateStr === "string" && dateStr.includes("T")
          ? new Date(dateStr).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
          : dateStr}
      </p>

      <div className="mt-8 space-y-8">
        <p className="text-[15px] leading-relaxed text-zinc-300">
          {notes.summary}
        </p>

        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
            What worked
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {notes.what_worked || notes.best_moment}
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
            What didn&apos;t
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">
            {notes.what_to_rethink || notes.worst_moment}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 px-5 py-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
            The instruction
          </h2>
          <p className="text-sm leading-relaxed text-zinc-300">
            {notes.next_time || notes.one_thing_to_fix}
          </p>
        </div>

        <div className="border-t border-zinc-800/30 pt-8 text-center">
          <p className="mb-4 text-sm text-zinc-600">Go again.</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-950 transition-all hover:bg-zinc-200"
          >
            <Mic className="h-4 w-4" />
            Spar again
          </Link>
        </div>

        <div className="pb-4 text-center">
          <ShareLink />
        </div>
      </div>
    </div>
  );
}
