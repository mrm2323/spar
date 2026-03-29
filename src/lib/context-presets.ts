/**
 * Quick situations for the dashboard. Selection is sent as `situationPreset` to
 * `/api/session/start` (not injected into the textarea).
 */
export const CONTEXT_SITUATION_PRESETS = [
  "Breakup",
  "Roommate talk",
  "Elevator pitch",
  "Networking event",
  "Boss conversation",
  "Salary / offer conversation",
  "Professor or TA",
  "Family conversation",
  "First date",
  "Difficult feedback",
] as const;

export type ContextSituationPreset = (typeof CONTEXT_SITUATION_PRESETS)[number];

/** Legacy bracket lines from older clients — extract label if present. */
export function parseSituationMarker(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/\[situation:\s*([^\]]+)]/i);
  return m?.[1]?.trim() || null;
}

/** First spoken line when user pre-selected a situation (passed separately, not in textarea). */
export function buildSituationFirstMessage(
  situationLabel: string,
  firstName?: string | null
): string {
  const focus = situationLabel.trim();
  const n = firstName?.trim();
  if (n) {
    return `Hey ${n} — it's Kabir. You wanted to work on your ${focus}. I'm already with you on that — don't recap the whole thing unless you need to. What's the first line or the part that feels stuck?`;
  }
  return `Hey — it's Kabir. You wanted to work on your ${focus}. I'm already with you on that. What's the first line or the part that feels stuck?`;
}
