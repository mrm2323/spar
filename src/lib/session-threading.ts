type ThreadableSession = {
  id: string;
  context: string | null;
  ended_at: string | null;
  notes_preview?: string | null;
};

type SessionThread<T extends ThreadableSession> = {
  id: string;
  head: T;
  headTokens: Set<string>;
  attempts: number;
  sessions: T[];
};

const IGNORED_TOKENS = new Set([
  "key",
  "shift",
  "next",
  "move",
  "kabir",
  "practice",
  "session",
  "conversation",
  "your",
  "with",
  "this",
  "that",
  "from",
  "have",
  "been",
  "just",
]);

function toKeyText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokenSet(value: string | null | undefined): Set<string> {
  const clean = toKeyText(value);
  const words = clean
    .split(" ")
    .filter((w) => w.length >= 4 && !IGNORED_TOKENS.has(w));
  return new Set(words);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function groupSessionsIntoThreads<T extends ThreadableSession>(
  sessions: T[],
  options?: {
    maxHoursApart?: number;
    minSimilarity?: number;
  }
): Array<{ id: string; head: T; attempts: number; sessions: T[] }> {
  const maxHoursApart = options?.maxHoursApart ?? 72;
  const minSimilarity = options?.minSimilarity ?? 0.28;

  const threads: Array<SessionThread<T>> = [];

  for (const session of sessions) {
    const sessionText = session.context || session.notes_preview || "";
    const sessionTokens = toTokenSet(sessionText);
    const sessionEnded = session.ended_at
      ? new Date(session.ended_at).getTime()
      : Date.now();

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < threads.length; i += 1) {
      const t = threads[i];
      const headEnded = t.head.ended_at
        ? new Date(t.head.ended_at).getTime()
        : Date.now();
      const hoursApart = Math.abs(sessionEnded - headEnded) / (1000 * 60 * 60);

      const exactContextMatch =
        toKeyText(session.context) &&
        toKeyText(session.context) === toKeyText(t.head.context);

      const score = exactContextMatch ? 1 : similarity(sessionTokens, t.headTokens);
      const closeEnough = hoursApart <= maxHoursApart;

      if (closeEnough && score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestScore >= minSimilarity) {
      threads[bestIdx].attempts += 1;
      threads[bestIdx].sessions.push(session);
      continue;
    }

    threads.push({
      id: session.id,
      head: session,
      headTokens: sessionTokens,
      attempts: 1,
      sessions: [session],
    });
  }

  return threads.map((t) => ({
    id: t.id,
    head: t.head,
    attempts: t.attempts,
    sessions: t.sessions,
  }));
}
