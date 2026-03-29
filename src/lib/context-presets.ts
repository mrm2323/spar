/**
 * Quick situations users can tag before a session. Appended as structured lines;
 * users can still type anything — this only helps Kabir tune faster.
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

const MARKER_PREFIX = "[situation:";

/** Append a preset line if not already present (case-sensitive on label). */
export function appendSituationPreset(
  current: string,
  label: string
): string {
  const line = `${MARKER_PREFIX} ${label.trim()}]`;
  if (current.includes(line)) return current;
  const base = current.trim();
  return base ? `${base}\n\n${line}` : line;
}
