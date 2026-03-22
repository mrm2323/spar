/**
 * Stats derived from Vapi transcript (messages array or string).
 */

const FILLER_WORDS = new Set([
  "um",
  "uh",
  "like",
  "basically",
  "literally",
  "actually",
  "kinda",
  "sorta",
  "you know",
  "i mean",
]);

export type TranscriptMessage = {
  role?: string;
  speaker?: string;
  content?: string;
  message?: string;
  text?: string;
};

function normalizeTranscript(
  transcript: unknown
): TranscriptMessage[] | null {
  if (!transcript) return null;
  if (typeof transcript === "string") {
    try {
      const parsed = JSON.parse(transcript) as unknown;
      if (Array.isArray(parsed)) return parsed as TranscriptMessage[];
    } catch {
      return null;
    }
    return null;
  }
  if (Array.isArray(transcript)) return transcript as TranscriptMessage[];
  return null;
}

function isUserRole(role: string | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return r === "user" || r === "customer";
}

function isAssistantRole(role: string | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return (
    r === "assistant" ||
    r === "bot" ||
    r === "system" ||
    r === "kabir" ||
    r === "agent"
  );
}

function isPromptArtifact(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (
    t.includes("You are Kabir.") ||
    t.includes("WHAT YOU KNOW ABOUT THIS PERSON") ||
    t.includes("HOW YOU HELP") ||
    t.includes("NEVER DO THESE THINGS") ||
    t.includes("CONTINUING WHERE YOU LEFT OFF")
  ) {
    return true;
  }
  return t.length > 2200 && (t.includes("========================") || t.includes("\\n- "));
}

export function computeTranscriptStats(transcript: unknown): {
  userWordCount: number;
  assistantWordCount: number;
  userRatio: number;
  assistantRatio: number;
  fillers: { word: string; count: number }[];
} {
  const messages = normalizeTranscript(transcript);
  let userWords = 0;
  let assistantWords = 0;
  const fillerCounts = new Map<string, number>();

  if (!messages || messages.length === 0) {
    return {
      userWordCount: 0,
      assistantWordCount: 0,
      userRatio: 50,
      assistantRatio: 50,
      fillers: [],
    };
  }

  for (const m of messages) {
    const text = String(m.content || m.message || m.text || "").trim();
    if (!text || isPromptArtifact(text)) continue;
    const role = m.role || m.speaker;
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (isUserRole(role)) {
      userWords += words.length;
      for (const w of words) {
        const clean = w.replace(/[^a-z']/g, "");
        if (FILLER_WORDS.has(clean)) {
          fillerCounts.set(clean, (fillerCounts.get(clean) || 0) + 1);
        }
      }
    } else if (isAssistantRole(role)) {
      assistantWords += words.length;
    }
  }

  const total = userWords + assistantWords;
  const userRatio =
    total > 0 ? Math.round((userWords / total) * 100) : 50;
  const assistantRatio = total > 0 ? 100 - userRatio : 50;

  const fillers = [...fillerCounts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    userWordCount: userWords,
    assistantWordCount: assistantWords,
    userRatio,
    assistantRatio,
    fillers,
  };
}

/** First quoted substring (straight or curly quotes), or first ~160 chars if none */
export function extractQuotedSection(text: string): {
  quote: string;
  rest: string;
} {
  const m =
    text.match(/"([^"]+)"/) ||
    text.match(/\u201C([^\u201D]+)\u201D/);
  if (m) {
    const rest = text
      .replace(m[0], "")
      .replace(/^[\s.,:—\-]+/, "")
      .trim();
    return { quote: m[1], rest };
  }
  const trimmed = text.trim();
  return {
    quote: trimmed.slice(0, 160) + (trimmed.length > 160 ? "…" : ""),
    rest: "",
  };
}

/** Split summary into 2–3 sentences for "Kabir's take" */
export function kabirsTakeFromSummary(summary: string): string {
  const s = summary.trim();
  if (!s) return "";
  const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length <= 3) return parts.join(" ");
  return parts.slice(0, 3).join(" ");
}
