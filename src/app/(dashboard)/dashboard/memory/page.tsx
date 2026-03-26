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
import { UnderstandingMap } from "@/components/UnderstandingMap";

type PatternCard = {
  name: string;
  description: string;
  status: "improving" | "persistent";
  sessionCount: number;
};

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

function formatRelativeDiscussed(iso: string | null): string {
  if (!iso) return "Recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recently";
  const diff = (Date.now() - d.getTime()) / 86_400_000;
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 7) return `${Math.floor(diff)} days ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function narrativeLine(summary: string): string {
  const s = summary.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const parts = s.split(/(?<=[.!?])\s+/);
  const first = parts[0]?.trim() ?? "";
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
  "rounded-xl border border-slate-700/55 bg-[#0b1d3e]/50 shadow-[0_0_0_1px_rgba(15,23,42,0.4)]";

export default function MemoryDashboardPage() {
  const [portrait, setPortrait] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<PatternCard[]>([]);
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

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch("/api/memory/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load profile");
      setPortrait(typeof data.portrait === "string" ? data.portrait : "");
      setPatterns(Array.isArray(data.patterns) ? data.patterns : []);
      setSessionCount(typeof data.sessionCount === "number" ? data.sessionCount : 0);
      setGeneratedAt(typeof data.generatedAt === "string" ? data.generatedAt : null);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not load profile");
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
          typeof listData.error === "string" ? listData.error : "Could not load goals"
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
    if (!confirm("Delete all memory for this account? This cannot be undone.")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "forget-all" }),
      });
      if (res.ok) {
        await loadEntriesAndPref();
        await loadProfile();
        await loadPeople();
      }
    } finally {
      setClearing(false);
    }
  }

  const subtitle = useMemo(() => {
    const n = sessionCount;
    if (n === 0) return "Built from your conversations. Updated after every session.";
    if (n === 1) return "Built from 1 conversation. Updated after every session.";
    return `Built from ${n} conversations. Updated after every session.`;
  }, [sessionCount]);

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-16 text-[#E2E8F0]">
      {/* HEADER */}
      <header className="text-center sm:text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
          What Kabir knows about you
        </h1>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        {generatedAt ? (
          <p className="mt-1 text-[11px] text-slate-600">
            Portrait last refreshed{" "}
            {new Date(generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        ) : null}
      </header>

      {/* SECTION 0 — UNDERSTANDING MAP */}
      <UnderstandingMap
        sessionCount={sessionCount}
        patterns={patterns}
        people={people}
        goalEntries={goalEntries}
      />

      {/* SECTION 1 — YOU AS A COMMUNICATOR */}
      <section className={`${CARD} p-6 sm:p-8`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-400/80">
          You as a communicator
        </h2>
        {profileLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Shaping your portrait…
          </div>
        ) : profileError ? (
          <p className="mt-4 text-sm text-amber-200/90">{profileError}</p>
        ) : (
          <p className="mt-6 text-[17px] leading-[1.75] text-slate-100 sm:text-[18px]">
            {portrait || "—"}
          </p>
        )}
      </section>

      {/* SECTION 2 — YOUR PATTERNS */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          Your patterns
        </h2>
        {profileLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : patterns.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Patterns will show up here as Kabir gets more reps with you.
          </p>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {patterns.map((p) => (
              <div
                key={p.name}
                className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-4"
              >
                <p className="font-mono text-[11px] font-semibold tracking-wide text-cyan-200/90">
                  {p.name}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  {p.description}
                </p>
                <p
                  className={`mt-3 text-xs font-medium ${
                    p.status === "improving"
                      ? "text-emerald-400/95"
                      : "text-amber-400/95"
                  }`}
                >
                  {p.status === "improving" ? "Improving" : "Persistent"}
                  <span className="ml-2 font-normal text-slate-500">
                    · seen across ~{p.sessionCount} sessions
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 3 — PEOPLE */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          People Kabir knows about
        </h2>
        {peopleLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : people.length === 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-500">
            As you talk to Kabir about the people in your life, he&apos;ll build a picture
            of each one here.
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
                        Last discussed: {formatRelativeDiscussed(person.lastDiscussedIso)}
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

      {/* SECTION 4 — PROGRESS TIMELINE */}
      <section className={`${CARD} p-6`}>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
          Your progress
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Your journey through Kabir&apos;s eyes — one line per session.
        </p>
        {timelineLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : timeline.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No completed sessions yet. Finish a practice and open Kabir&apos;s notes.
          </p>
        ) : (
          <ul className="mt-5 space-y-4 border-l border-slate-700/60 pl-4">
            {timeline.map((row) => {
              const line = narrativeLine(row.summary);
              const dateLabel = formatTimelineDate(row.date);
              return (
                <li key={row.id} className="relative text-sm leading-relaxed text-slate-300">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-cyan-500/70" />
                  <span className="font-mono text-[11px] text-slate-500">{dateLabel}</span>
                  <span className="text-slate-500">: </span>
                  {line ? (
                    <span>{line}</span>
                  ) : row.context ? (
                    <span>{row.context.slice(0, 160)}</span>
                  ) : (
                    <span className="text-slate-500">Session saved.</span>
                  )}
                  <Link
                    href={`/notes/${row.id}`}
                    className="ml-2 text-[11px] text-cyan-400/90 hover:text-cyan-300"
                  >
                    Notes →
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* SECTION 5 — GOALS */}
      <section className={`${CARD} p-6`}>
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 text-cyan-400/80" aria-hidden />
          <div className="flex-1">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">
              Goals
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              What you want Kabir to remember to push on. He can flag progress here after
              sessions.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="e.g. Ask my manager for role clarity"
                className="min-w-0 flex-1 rounded-lg border border-slate-600/70 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 outline-none focus:border-cyan-500/55"
              />
              <button
                type="button"
                onClick={() => void addGoal()}
                disabled={goalSaving || !newGoal.trim()}
                className="rounded-lg bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-40"
              >
                {goalSaving ? "Adding…" : "Add goal"}
              </button>
            </div>
            {entriesLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading goals…</p>
            ) : entriesError ? (
              <p className="mt-4 text-sm text-amber-200/90">{entriesError}</p>
            ) : goalEntries.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No goals yet. Add what you want Kabir to hold you accountable for.
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
                          Kabir noticed progress ·{" "}
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

      {/* SECTION 6 — CONTROLS */}
      <section className={`${CARD} space-y-6 p-6`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-100">Memory in coaching</p>
            <p className="mt-1 text-xs text-slate-500">
              {enabled
                ? "On — Kabir uses what he knows to personalize practice."
                : "Off — each session starts without your stored portrait."}
            </p>
          </div>
          <button
            type="button"
            disabled={savingPref}
            onClick={() => void savePreference(!enabled)}
            className={`shrink-0 rounded-full px-5 py-2 text-xs font-semibold transition-colors ${
              enabled
                ? "border border-cyan-500/50 bg-cyan-500/15 text-cyan-100"
                : "border border-slate-600 bg-slate-800 text-slate-300"
            }`}
          >
            {savingPref ? "…" : enabled ? "Memory on" : "Memory off"}
          </button>
        </div>

        <div className="border-t border-slate-800/80 pt-4">
          <button
            type="button"
            disabled={clearing}
            onClick={() => void clearAllMemories()}
            className="text-xs text-rose-400/80 underline decoration-rose-500/30 underline-offset-2 transition-colors hover:text-rose-300"
          >
            {clearing ? "Deleting…" : "Delete all memory"}
          </button>
        </div>

        <p className="flex items-center gap-2 text-[11px] text-slate-600">
          <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
          Your data is encrypted and private. Only you and Kabir&apos;s coaching systems
          see this.
        </p>
      </section>
    </div>
  );
}
