"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type MemoryEntry = {
  id: string;
  content: string;
  metadata?: {
    category?: string;
    status?: "planned" | "attempted" | "done";
    thread?: string;
    [key: string]: unknown;
  };
};

type TimelineItem = {
  id: string;
  date: string | null;
  context: string;
  summary: string;
};

export default function MemorySettingsPage() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [newGoal, setNewGoal] = useState("");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [supermemoryConfigured, setSupermemoryConfigured] = useState(true);

  async function loadPreferences() {
    const res = await fetch("/api/memory/preferences");
    const data = await res.json();
    if (res.ok) setEnabled(Boolean(data.enabled));
  }

  async function loadEntries() {
    setEntriesError(null);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", limit: 40 }),
    });
    const data = await res.json();
    if (!res.ok) {
      setEntriesError(
        typeof data.error === "string" ? data.error : "Could not load memory list."
      );
      return;
    }

    const items = (data.memories || []) as MemoryEntry[];
    setEntries(items);
    const drafts: Record<string, string> = {};
    for (const item of items) drafts[item.id] = item.content || "";
    setDraftById(drafts);
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    try {
      const res = await fetch("/api/memory/history");
      const data = await res.json();
      if (res.ok) {
        setTimeline((data.timeline || []) as TimelineItem[]);
        setSupermemoryConfigured(Boolean(data.supermemoryConfigured));
      }
    } finally {
      setTimelineLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([loadPreferences(), loadEntries(), loadTimeline()]).finally(() =>
      setLoading(false)
    );
  }, []);

  const goalEntries = useMemo(
    () => entries.filter((e) => e.metadata?.category === "goals"),
    [entries]
  );

  async function savePreference(next: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/memory/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setEnabled(next);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id: string) {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "forget", memoryId: id }),
    });
    if (!res.ok) return;
    await loadEntries();
  }

  async function saveEntry(id: string) {
    const content = (draftById[id] || "").trim();
    if (!content) return;
    const current = entries.find((e) => e.id === id);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        memoryId: id,
        newContent: content,
        category: current?.metadata?.category || "general",
        metadata: current?.metadata || {},
      }),
    });
    if (!res.ok) return;
    await loadEntries();
  }

  async function updateGoalStatus(id: string, status: "planned" | "attempted" | "done") {
    const current = entries.find((e) => e.id === id);
    if (!current) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        memoryId: id,
        newContent: draftById[id] || current.content,
        category: "goals",
        metadata: {
          ...(current.metadata || {}),
          category: "goals",
          status,
        },
      }),
    });
    if (!res.ok) return;
    await loadEntries();
  }

  async function addGoal() {
    const trimmed = newGoal.trim();
    if (!trimmed) return;
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
    if (!res.ok) return;
    setNewGoal("");
    await loadEntries();
  }

  async function clearAllMemories() {
    if (!confirm("Delete all memory for this account? This cannot be undone.")) return;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "forget-all" }),
    });
    if (!res.ok) return;
    await loadEntries();
  }

  if (loading) {
    return <div className="py-8 text-sm text-slate-300">Loading memory settings...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="rounded-xl border border-slate-700/60 bg-[#0b1d3e]/45 p-5">
        <h1 className="text-lg font-semibold text-slate-100">Memory settings</h1>
        <p className="mt-2 text-sm text-slate-300">
          Control whether Kabir uses memory in coaching, and review/edit stored facts.
        </p>
        {!supermemoryConfigured && (
          <p className="mt-3 rounded-lg border border-slate-600/40 bg-slate-700/20 px-3 py-2 text-xs text-slate-300/95">
            Kabir is using your{" "}
            <strong className="font-medium">recent practice timeline</strong> from this
            session to personalize coaching.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-slate-700/60 bg-slate-900/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-100">
              Use memory in coaching
              <span className="ml-2 rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
                Recommended
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              When turned off, Kabir still works, but he will not use past memory to personalize coaching.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Current state: {enabled ? "On - personalized coaching" : "Off - fresh-session coaching"}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => savePreference(!enabled)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              enabled
                ? "border border-cyan-500/50 bg-cyan-500/20 text-cyan-200"
                : "border border-slate-600 bg-slate-800 text-slate-300"
            }`}
          >
            {enabled ? "On" : "Off"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            placeholder="Add a goal (e.g., Ask manager for role clarity)"
            className="min-w-[260px] flex-1 rounded-md border border-slate-600/70 bg-slate-900/40 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/60"
          />
          <button
            type="button"
            onClick={addGoal}
            className="rounded-md border border-cyan-500/50 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
          >
            Add goal
          </button>
          <button
            type="button"
            onClick={clearAllMemories}
            className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
          >
            Delete all memory
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-[#0b1d3e]/45 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Practice history
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Completed sessions and Kabir&apos;s take — this timeline is always stored here
          so coaching can stay continuous even when cloud memory is still indexing.
        </p>
        {timelineLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading history…</p>
        ) : timeline.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No completed sessions yet. Finish a call and open Kabir&apos;s notes to build
            your history.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {timeline.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-slate-500">
                  <span>
                    {row.date
                      ? new Date(row.date).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "—"}
                  </span>
                  <Link
                    href={`/notes/${row.id}`}
                    className="text-cyan-400/90 hover:text-cyan-300"
                  >
                    View notes →
                  </Link>
                </div>
                {row.context ? (
                  <p className="mt-2 text-slate-300">
                    <span className="text-slate-500">Topic: </span>
                    {row.context}
                  </p>
                ) : null}
                {row.summary ? (
                  <p className="mt-1 text-slate-400 line-clamp-4">{row.summary}</p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">Notes still generating…</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-[#0b1d3e]/45 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Stored memory</h2>
        <p className="mt-1 text-xs text-slate-400">
          Facts Kabir can retrieve (semantic memory). Edit or remove anything wrong.
        </p>
        {entriesError ? (
          <p className="mt-3 text-sm text-amber-200/90">{entriesError}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {!entriesError && entries.length === 0 && (
            <p className="text-sm text-slate-400">
              No individual memory entries yet. They appear after calls when facts are
              extracted, or add a goal above.
            </p>
          )}

          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-slate-700/60 bg-slate-900/35 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
                <span>{entry.metadata?.category || "general"}</span>
                {entry.metadata?.thread && <span>Thread: {String(entry.metadata.thread)}</span>}
                {entry.metadata?.status && <span>Status: {String(entry.metadata.status)}</span>}
              </div>

              <textarea
                value={draftById[entry.id] || ""}
                onChange={(e) =>
                  setDraftById((prev) => ({ ...prev, [entry.id]: e.target.value }))
                }
                rows={2}
                className="w-full rounded-md border border-slate-600/70 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-500/60"
              />

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveEntry(entry.id)}
                  className="rounded-md border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => deleteEntry(entry.id)}
                  className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                >
                  Delete
                </button>

                {entry.metadata?.category === "goals" && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateGoalStatus(entry.id, "planned")}
                      className="rounded-md border border-slate-600/80 bg-slate-900/30 px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      Planned
                    </button>
                    <button
                      type="button"
                      onClick={() => updateGoalStatus(entry.id, "attempted")}
                      className="rounded-md border border-slate-600/80 bg-slate-900/30 px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      Attempted
                    </button>
                    <button
                      type="button"
                      onClick={() => updateGoalStatus(entry.id, "done")}
                      className="rounded-md border border-slate-600/80 bg-slate-900/30 px-2 py-1.5 text-[11px] text-slate-200"
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {goalEntries.length > 0 && (
        <section className="rounded-xl border border-slate-700/60 bg-[#0b1d3e]/45 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Goal tracking</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {goalEntries.map((goal) => (
              <li key={goal.id} className="rounded-md border border-slate-700/60 bg-slate-900/30 px-3 py-2">
                {goal.content}
                <span className="ml-2 text-xs text-slate-400">
                  ({goal.metadata?.status || "planned"})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
