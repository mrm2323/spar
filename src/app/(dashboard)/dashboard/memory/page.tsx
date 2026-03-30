"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
  Target,
} from "lucide-react";
import {
  computeKabirInsightMetrics,
  type KabirInsightKey,
} from "@/lib/memory/kabir-insight-scores";

type PersonCard = {
  name: string;
  relationship?: string;
  summary: string;
  fullProfile: string;
  lastDiscussedIso: string | null;
};

type TimelineRow = {
  id: string;
  date: string | null;
  context: string;
  summary: string;
};

type MemoryEntry = {
  id: string;
  content: string;
  metadata?: {
    category?: string;
    status?: "planned" | "attempted" | "done";
    kabirNoticedAt?: string;
    [key: string]: unknown;
  };
};

function startOfLocalDay(t: number): number {
  const x = new Date(t);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** Calendar-relative "Today" / "Yesterday" / N days ago — not rolling 24h windows. */
function formatRelativeDiscussed(iso: string | null): string {
  if (!iso) return "Recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recently";
  const now = Date.now();
  const dayDiff = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(d.getTime())) / 86_400_000
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** First sentence or truncated line (no lookbehind regex — broader browser support). */
function narrativeLine(summary: string): string {
  const s = summary.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const end = s.search(/[.!?](\s|$)/);
  const first =
    end === -1 ? s : s.slice(0, end + 1).trim();
  if (first.length > 0 && first.length <= 240) return first;
  return s.length > 200 ? `${s.slice(0, 197).trim()}…` : s;
}

function formatTimelineDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const CARD =
  "rounded-2xl border border-white/[0.08] bg-[#12121a]/90 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]";

export default function MemoryDashboardPage() {
  const [portrait, setPortrait] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const [people, setPeople] = useState<PersonCard[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);

  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [savingPref, setSavingPref] = useState(false);
  const [newGoal, setNewGoal] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [memoryActionBanner, setMemoryActionBanner] = useState<string | null>(
    null
  );

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/memory/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "couldn't load your portrait");
      setPortrait(typeof data.portrait === "string" ? data.portrait : "");
      setSessionCount(typeof data.sessionCount === "number" ? data.sessionCount : 0);
      setGeneratedAt(typeof data.generatedAt === "string" ? data.generatedAt : null);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "couldn't load your portrait");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadPeople = useCallback(async () => {
    setPeopleLoading(true);
    try {
      const res = await fetch("/api/memory/people");
      const data = await res.json();
      if (res.ok && Array.isArray(data.people)) setPeople(data.people);
    } finally {
      setPeopleLoading(false);
    }
  }, []);

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await fetch("/api/memory/history");
      const data = await res.json();
      if (res.ok && Array.isArray(data.timeline)) setTimeline(data.timeline);
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const loadEntriesAndPref = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const [prefRes, listRes] = await Promise.all([
        fetch("/api/memory/preferences"),
        fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list", limit: 60 }),
        }),
      ]);
      const prefData = await prefRes.json();
      if (prefRes.ok) setEnabled(Boolean(prefData.enabled));

      const listData = await listRes.json();
      if (!listRes.ok) {
        setEntriesError(
          typeof listData.error === "string" ? listData.error : "couldn't load goals"
        );
        return;
      }
      setEntries((listData.memories || []) as MemoryEntry[]);
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadPeople();
      void loadTimeline();
    }, 0);
    return () => clearTimeout(t);
  }, [loadPeople, loadTimeline]);

  useEffect(() => {
    void loadEntriesAndPref();
  }, [loadEntriesAndPref]);

  const goalEntries = useMemo(
    () => entries.filter((e) => e.metadata?.category === "goals"),
    [entries]
  );

  async function savePreference(next: boolean) {
    setSavingPref(true);
    try {
      const res = await fetch("/api/memory/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setEnabled(next);
    } finally {
      setSavingPref(false);
    }
  }

  async function addGoal() {
    const trimmed = newGoal.trim();
    if (!trimmed) return;
    setGoalSaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remember",
          content: `Goal: ${trimmed}`,
          category: "goals",
          metadata: {
            category: "goals",
            status: "planned",
            source: "manual_goal",
          },
        }),
      });
      if (res.ok) {
        setNewGoal("");
        await loadEntriesAndPref();
      }
    } finally {
      setGoalSaving(false);
    }
  }

  async function clearAllMemories() {
    if (!confirm("make kabir forget everything on this account? can't undo.")) return;
    setClearing(true);
    setMemoryActionBanner(null);
    try {
      const res = await fetch("/api/memory/forget-all", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        setMemoryActionBanner(
          typeof data.error === "string"
            ? data.error
            : "couldn't clear everything. try again?"
        );
        return;
      }
      setMemoryActionBanner(
        "cleared. kabir's coaching memory on this account is wiped."
      );
      await loadEntriesAndPref();
      await loadProfile();
      await loadPeople();
      await loadTimeline();
    } finally {
      setClearing(false);
    }
  }

  const subtitle = useMemo(() => {
    const n = sessionCount;
    if (n === 0) return "this grows every time you talk to kabir.";
    if (n === 1) return "one conversation in. kabir updates this after every practice.";
    return `${n} conversations deep. kabir updates this after every practice.`;
  }, [sessionCount]);

  /** Same 0–100 math as the dashboard “Kabir understanding map” — see `computeKabirInsightMetrics`. */
  const insightScores = useMemo(() => {
    const progressedGoals = goalEntries.filter(
      (g) => typeof g.metadata?.kabirNoticedAt === "string" && g.metadata.kabirNoticedAt
    ).length;
    const metrics = computeKabirInsightMetrics({
      sessionCount,
      patterns: [],
      people,
      goalEntries,
    });
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m.value])) as Record<
      KabirInsightKey,
      number
    >;

    return [
      {
        key: "consistency" as const,
        label: "showing up",
        value: byKey.consistency,
        detail: `${sessionCount} practice${sessionCount === 1 ? "" : "s"} · same scale as dashboard map`,
      },
      {
        key: "people" as const,
        label: "people you've named",
        value: byKey.people,
        detail: `${people.length} person${people.length === 1 ? "" : "s"} · kabir tracks up to 5`,
      },
      {
        key: "goals" as const,
        label: "goals you asked him to hold",
        value: byKey.goals,
        detail:
          goalEntries.length === 0
            ? "add one when you're ready"
            : `${progressedGoals}/${goalEntries.length} where kabir saw movement`,
      },
    ];
  }, [sessionCount, people, goalEntries]);

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-16 text-[#E2E8F0]">
      {/* HEADER */}
      <header className="text-center sm:text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
          what kabir knows about you
        </h1>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        {generatedAt ? (
          <p className="mt-1 text-[11px] text-slate-600">
            portrait last refreshed{" "}
            {new Date(generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        ) : null}
        {memoryActionBanner ? (
          <p className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100/95">
            {memoryActionBanner}
          </p>
        ) : null}
      </header>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] px-4 py-4 text-sm leading-relaxed text-slate-400">
        <p className="font-medium text-slate-200">how memory works</p>
        <p className="mt-2">
          when memory is on, kabir pulls from past sessions, notes, and stored facts so he
          isn&apos;t starting cold. use &quot;make kabir forget everything&quot; to wipe stored
          coaching memory.
        </p>
      </div>

      {/* SECTION 0 — UNDERSTANDING MAP */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/85">
          how well kabir knows you
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          rough signal, not a grade — it's how much context he's stacked from your practices.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {insightScores.map((item) => (
            <div
              key={item.key}
              className="rounded-lg border border-slate-700/50 bg-slate-950/35 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-slate-200">{item.label}</p>
                <span className="font-mono text-[11px] text-cyan-300/95">{item.value}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500/85 to-violet-600/70 transition-all"
                  style={{ width: `${item.value}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SECTION 1 — YOU AS A COMMUNICATOR */}
      <section className={`${CARD} p-6 sm:p-8`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/85">
          you, in kabir&apos;s words
        </h2>
        {profileLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            kabir&apos;s thinking…
          </div>
        ) : profileError ? (
          <p className="mt-4 text-sm text-rose-200/90">{profileError}</p>
        ) : (
          <p className="mt-6 text-[17px] leading-[1.75] text-slate-100 sm:text-[18px]">
            {portrait || "—"}
          </p>
        )}
      </section>

      {/* SECTION 2 — PEOPLE */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          people you&apos;ve brought up
        </h2>
        {peopleLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            kabir&apos;s thinking…
          </div>
        ) : people.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-500">
            name your roommate, your manager, whoever — kabir builds a card for each one.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {people.map((person, idx) => {
              const key = `person-${idx}-${person.name}`;
              const open = expandedPerson === key;
              return (
                <div
                  key={key}
                  className="rounded-lg border border-slate-700/50 bg-slate-950/35"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedPerson(open ? null : key)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-900/40"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">
                        {person.name}
                        {person.relationship ? (
                          <span className="text-slate-500"> — {person.relationship}</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        {person.summary}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-600">
                        last talked about: {formatRelativeDiscussed(person.lastDiscussedIso)}
                      </p>
                    </div>
                    {open ? (
                      <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
                    )}
                  </button>
                  {open ? (
                    <div className="border-t border-slate-800/80 px-4 py-3 text-sm leading-relaxed text-slate-300">
                      {person.fullProfile}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 3 — PROGRESS TIMELINE */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          your practice history
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          one line per practice — how kabir remembers it.
        </p>
        {timelineLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            kabir&apos;s thinking…
          </div>
        ) : timeline.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            first time? finish a practice, then open kabir&apos;s notes — it shows up here.
          </p>
        ) : (
          <ul className="mt-5 space-y-4 border-l border-slate-700/60 pl-4">
            {timeline.map((row) => {
              const line = narrativeLine(row.summary);
              const dateLabel = formatTimelineDate(row.date);
              return (
                <li key={row.id} className="relative text-sm leading-relaxed text-slate-300">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-cyan-500/75" />
                  <span className="font-mono text-[11px] text-slate-500">{dateLabel}</span>
                  <span className="text-slate-500">: </span>
                  {line ? (
                    <span>{line}</span>
                  ) : row.context ? (
                    <span>{row.context.slice(0, 160)}</span>
                  ) : (
                    <span className="text-slate-500">saved — notes still loading.</span>
                  )}
                  <Link
                    href={`/notes/${row.id}`}
                    className="ml-2 text-[11px] text-cyan-400/95 hover:text-violet-300"
                  >
                    {"kabir's take →"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* SECTION 4 — GOALS */}
      <section className={`${CARD} p-6`}>
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 text-cyan-400/85" aria-hidden />
          <div className="flex-1">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
              what you want him to push on
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              drop a goal. after sessions, kabir can flag when he sees you move on it.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="e.g. ask my manager for role clarity"
                className="min-w-0 flex-1 rounded-xl border border-slate-600/70 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-500/55"
              />
              <button
                type="button"
                onClick={() => void addGoal()}
                disabled={goalSaving || !newGoal.trim()}
                className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-5 py-3 text-sm font-semibold text-[#0A0A0F] transition-colors hover:opacity-95 disabled:opacity-40"
              >
                {goalSaving ? "adding…" : "add goal"}
              </button>
            </div>
            {entriesLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                kabir&apos;s thinking…
              </div>
            ) : entriesError ? (
              <p className="mt-4 text-sm text-rose-200/90">{entriesError}</p>
            ) : goalEntries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                no goals yet. add what you want him to nag you about.
              </p>
            ) : (
              <ul className="mt-5 space-y-3">
                {goalEntries.map((g) => {
                  const noticed = g.metadata?.kabirNoticedAt;
                  return (
                    <li
                      key={g.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/45 bg-slate-950/30 px-4 py-3 text-sm text-slate-200"
                    >
                      <Check
                        className={`h-4 w-4 shrink-0 ${
                          noticed ? "text-emerald-400" : "text-slate-600"
                        }`}
                        aria-hidden
                      />
                      <span className="flex-1">{g.content.replace(/^Goal:\s*/i, "")}</span>
                      {noticed ? (
                        <span className="text-xs text-emerald-400/90">
                          kabir noticed you moved on this ·{" "}
                          {new Date(noticed).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : (
                        <span className="text-xs capitalize text-slate-500">
                          {g.metadata?.status || "planned"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 5 — CONTROLS */}
      <section className={`${CARD} space-y-6 p-6`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-100">memory in coaching</p>
            <p className="mt-1 text-xs text-slate-500">
              {enabled
                ? "on — kabir uses what he knows to personalize practice."
                : "off — each practice starts without your stored portrait."}
            </p>
          </div>
          <button
            type="button"
            disabled={savingPref}
            onClick={() => void savePreference(!enabled)}
            className={`shrink-0 rounded-full px-5 py-2 text-xs font-semibold transition-colors ${
              enabled
                ? "border border-cyan-500/50 bg-cyan-500/12 text-cyan-100"
                : "border border-slate-600 bg-slate-800 text-slate-300"
            }`}
          >
            {savingPref ? "…" : enabled ? "memory on" : "memory off"}
          </button>
        </div>

        <div className="space-y-3 border-t border-slate-800/80 pt-4">
          <div>
            <button
              type="button"
              disabled={clearing}
              onClick={() => void clearAllMemories()}
              className="text-xs text-rose-400/80 underline decoration-rose-500/30 underline-offset-2 transition-colors hover:text-rose-300 disabled:opacity-40"
            >
              {clearing ? "clearing…" : "make kabir forget everything"}
            </button>
          </div>
        </div>

        <p className="flex items-center gap-2 text-[11px] text-slate-600">
          <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          your data is encrypted. only you and kabir&apos;s coaching systems see this.
        </p>
      </section>
    </div>
  );
}
