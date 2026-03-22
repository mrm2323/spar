"use client";

import { useCallback, useEffect, useState } from "react";

/** Enough time to have had the real conversation, without waiting a full day */
const MS_AFTER_SESSION = 60 * 60 * 1000; // 1 hour

function isEligible(createdAtIso: string | null): boolean {
  if (!createdAtIso) return false;
  const t = new Date(createdAtIso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t >= MS_AFTER_SESSION;
}

export function SessionOutcomeFollowUp({
  sessionId,
  sessionCreatedAt,
  initialSubmitted,
}: {
  sessionId: string;
  sessionCreatedAt: string | null;
  initialSubmitted: boolean;
}) {
  const [eligible, setEligible] = useState(() =>
    isEligible(sessionCreatedAt)
  );
  const [submitted, setSubmitted] = useState(initialSubmitted);
  const [outcome, setOutcome] = useState<"well" | "tough" | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (submitted || eligible || !sessionCreatedAt) return;
    const tick = () => setEligible(isEligible(sessionCreatedAt));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [sessionCreatedAt, eligible, submitted]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!outcome) {
        setError("Choose how it went first.");
        return;
      }
      setError(null);
      setSaving(true);
      try {
        const res = await fetch(`/api/session/${sessionId}/outcome`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome,
            user_note: note.trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof data.error === "string" ? data.error : "Could not save."
          );
          return;
        }
        setSubmitted(true);
      } finally {
        setSaving(false);
      }
    },
    [sessionId, outcome, note]
  );

  const showThankYou = submitted;
  const showForm =
    eligible && sessionCreatedAt && !submitted;

  if (!showThankYou && !showForm) return null;

  if (showThankYou) {
    return (
      <section className="mt-8 rounded-lg border border-slate-700/50 bg-slate-950/40 px-5 py-5">
        <p className="text-center text-sm text-slate-500">
          Thanks—that real-world signal helps Spar focus on what actually
          helps next time.
        </p>
      </section>
    );
  }

  if (!showForm) return null;

  return (
    <section className="mt-8 rounded-lg border border-slate-700/50 bg-slate-950/40 px-5 py-5">
      <h2 className="text-center text-base font-medium text-[#E2E8F0]">
        After the real conversation
      </h2>
      <p className="mx-auto mt-2 max-w-md text-center text-sm text-slate-500">
        When you&apos;ve had the talk you practiced (even if it went sideways),
        tell us how it landed. Optional note helps us tune Kabir and the
        product—not a scorecard.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => setOutcome("well")}
          className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors sm:max-w-[200px] ${
            outcome === "well"
              ? "border-emerald-400/80 bg-emerald-500/15 text-emerald-100"
              : "border-emerald-500/50 bg-transparent text-emerald-100/90 hover:bg-emerald-500/10"
          }`}
        >
          It went well
        </button>
        <button
          type="button"
          onClick={() => setOutcome("tough")}
          className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors sm:max-w-[200px] ${
            outcome === "tough"
              ? "border-amber-400/80 bg-amber-500/15 text-amber-100"
              : "border-amber-500/50 bg-transparent text-amber-100/90 hover:bg-amber-500/10"
          }`}
        >
          It was tough
        </button>
      </div>
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <label htmlFor="session-outcome-note" className="sr-only">
          Tell Kabir what happened (optional)
        </label>
        <textarea
          id="session-outcome-note"
          name="user_note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tell Kabir what happened (optional)"
          className="w-full resize-y rounded-lg border border-slate-600/60 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-slate-500"
        />
        {error ? (
          <p className="text-xs text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-slate-500/60 bg-slate-800/80 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700/80 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      </form>
    </section>
  );
}
