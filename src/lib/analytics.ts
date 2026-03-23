"use client";

import * as amplitude from "@amplitude/analytics-browser";
import { sessionReplayPlugin } from "@amplitude/plugin-session-replay-browser";

const AMPLITUDE_API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY?.trim() || "";
const AMPLITUDE_EVENTS_SERVER_URL =
  process.env.NEXT_PUBLIC_AMPLITUDE_EVENTS_SERVER_URL?.trim() || "";
const AMPLITUDE_REPLAY_TRACK_SERVER_URL =
  process.env.NEXT_PUBLIC_AMPLITUDE_REPLAY_TRACK_SERVER_URL?.trim() || "";
const AMPLITUDE_REPLAY_CONFIG_SERVER_URL =
  process.env.NEXT_PUBLIC_AMPLITUDE_REPLAY_CONFIG_SERVER_URL?.trim() || "";
const AMPLITUDE_ALLOWED_HOSTS = (
  process.env.NEXT_PUBLIC_AMPLITUDE_ALLOWED_HOSTS ||
  ""
)
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
let initialized = false;
let replayAttached = false;
let currentUserId: string | null = null;
let hasLoggedDisabledReason = false;

function firstPartyUrl(pathname: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${pathname}`;
}

function hostAllowed(hostname: string): boolean {
  // Fail open when no allowlist is provided, so analytics cannot silently stop on new domains.
  if (AMPLITUDE_ALLOWED_HOSTS.length === 0) return true;

  const host = hostname.toLowerCase();
  return AMPLITUDE_ALLOWED_HOSTS.some((allowed) => {
    if (allowed.startsWith(".")) {
      return host.endsWith(allowed);
    }
    return host === allowed;
  });
}

function canSendAnalytics(): boolean {
  if (typeof window === "undefined") return false;
  if (AMPLITUDE_API_KEY.length === 0) {
    if (!hasLoggedDisabledReason) {
      console.warn("[analytics] disabled: NEXT_PUBLIC_AMPLITUDE_API_KEY is missing");
      hasLoggedDisabledReason = true;
    }
    return false;
  }

  const allowed = hostAllowed(window.location.hostname);
  if (!allowed && !hasLoggedDisabledReason) {
    console.warn(
      `[analytics] disabled: hostname ${window.location.hostname} not in NEXT_PUBLIC_AMPLITUDE_ALLOWED_HOSTS`
    );
    hasLoggedDisabledReason = true;
  }
  return allowed;
}

export function getAnalyticsClientStatus(): {
  initialized: boolean;
  keyPresent: boolean;
  currentHost: string | null;
  hostAllowed: boolean;
  allowlist: string[];
  eventsServerUrl: string | null;
  replayTrackServerUrl: string | null;
  replayConfigServerUrl: string | null;
} {
  const currentHost =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : null;

  return {
    initialized,
    keyPresent: AMPLITUDE_API_KEY.length > 0,
    currentHost,
    hostAllowed: currentHost ? hostAllowed(currentHost) : false,
    allowlist: AMPLITUDE_ALLOWED_HOSTS,
    eventsServerUrl:
      AMPLITUDE_EVENTS_SERVER_URL ||
      (typeof window !== "undefined" ? firstPartyUrl("/api/amplitude/events") : null),
    replayTrackServerUrl:
      AMPLITUDE_REPLAY_TRACK_SERVER_URL ||
      (typeof window !== "undefined" ? firstPartyUrl("/api/amplitude/replay-track") : null),
    replayConfigServerUrl:
      AMPLITUDE_REPLAY_CONFIG_SERVER_URL ||
      (typeof window !== "undefined" ? firstPartyUrl("/api/amplitude/replay-config") : null),
  };
}

export function initAnalytics(userId?: string | null): void {
  if (!canSendAnalytics() || initialized) return;

  const eventsServerUrl = AMPLITUDE_EVENTS_SERVER_URL || firstPartyUrl("/api/amplitude/events");
  const replayTrackServerUrl =
    AMPLITUDE_REPLAY_TRACK_SERVER_URL || firstPartyUrl("/api/amplitude/replay-track");
  const replayConfigServerUrl =
    AMPLITUDE_REPLAY_CONFIG_SERVER_URL || firstPartyUrl("/api/amplitude/replay-config");

  if (!replayAttached) {
    // Attach replay plugin to the default analytics instance before init.
    // The plugin will maintain its own session tracking across all main Analytics sessions.
    const replay = sessionReplayPlugin({
      sampleRate: 1,
      // Helps replay/session linkage when users authenticate in the same tab.
      forceSessionTracking: true,
      // Mobile browsers occasionally miss history patch hooks.
      enableUrlChangePolling: true,
      ...(replayTrackServerUrl
        ? { trackServerUrl: replayTrackServerUrl }
        : {}),
      ...(replayConfigServerUrl
        ? { configServerUrl: replayConfigServerUrl }
        : {}),
    });
    amplitude.add(replay);
    replayAttached = true;
  }

  amplitude.init(AMPLITUDE_API_KEY, userId ?? undefined, {
    autocapture: true,
    defaultTracking: {
      pageViews: false,
      sessions: true,
      formInteractions: true,
      fileDownloads: true,
    },
    ...(eventsServerUrl ? { serverUrl: eventsServerUrl } : {}),
  });

  initialized = true;
  currentUserId = userId ?? null;

  console.log("[analytics] Initialized", { userId, initialized: true });
}

export function setAnalyticsUser(userId: string | null | undefined): void {
  if (!canSendAnalytics()) return;

  const nextUserId = userId ?? null;
  const prevUserId = currentUserId;

  if (nextUserId === prevUserId) return;

  amplitude.setUserId(nextUserId ?? undefined);

  // Start a fresh analytics session on auth transitions to avoid anonymous replay ownership.
  if (nextUserId || prevUserId) {
    amplitude.setSessionId(Date.now());
  }

  if (nextUserId) {
    trackEvent("analytics_user_linked", {
      auth_transition: prevUserId ? "user_switch" : "anonymous_to_authenticated",
    });
  }

  currentUserId = nextUserId;
}

export function identifyUser(
  properties: Record<string, string | number | boolean>
): void {
  if (!canSendAnalytics()) return;

  const identify = new amplitude.Identify();
  for (const [key, value] of Object.entries(properties)) {
    identify.set(key, value);
  }
  amplitude.identify(identify);
}

export function trackEvent(
  eventName: string,
  eventProperties?: Record<string, unknown>
): void {
  if (!canSendAnalytics()) return;
  amplitude.track(eventName, eventProperties);
}

/**
 * Forcefully clears all replay plugin session state from storage.
 * The replay plugin uses localStorage with keys like:
 * - amplitude_unsent_identify, amplitude_unsent_events (main SDK)
 * - sr_session_id, sr_session_sequence (replay plugin)
 * And IndexedDB databases for event queuing.
 */
function clearReplaySessionState(): void {
  if (typeof window === "undefined") return;
  
  // Clear known Amplitude/Replay session keys from localStorage
  const keysToRemove = [
    "sr_session_id",        // Replay session ID
    "sr_session_sequence",  // Replay event sequence
    "sr_session_start",     // Replay session start time
    "amplitude_session_id", // Main session ID in storage
    "amplitude_last_session_id", // Last recorded session
  ];

  try {
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    // localStorage might be blocked, continue anyway
    console.debug("[analytics] localStorage access blocked or unavailable", e);
  }

  // Clear IndexedDB databases that Amplitude/Replay might use
  // This ensures no stale session data persists
  try {
    const dbs = [
      "amplitudeDB",
      "amplitude",
      "amplitude_events",
      "amplitude_identify",
    ];
    
    for (const dbName of dbs) {
      const req = indexedDB.deleteDatabase(dbName);
      req.onerror = () => {
        console.debug(`[analytics] Could not delete IndexedDB: ${dbName}`);
      };
    }
  } catch (e) {
    // IndexedDB might be unavailable, continue anyway
    console.debug("[analytics] IndexedDB access blocked or unavailable", e);
  }
}

export function startPracticeReplaySession(
  metadata?: Record<string, unknown>
): void {
  if (!canSendAnalytics()) return;

  console.log("[analytics] Starting new practice replay session", {
    current_user: currentUserId,
    metadata,
  });

  // Step 1: Flush any pending events/tracking from the previous session
  // This is critical - must complete before we change session state
  amplitude.flush();

  // Step 2: Clear ALL replay plugin session state from storage
  // This forces the plugin to recognize this as a completely new session
  clearReplaySessionState();

  // Step 3: Generate and set a completely new session ID
  // Using Date.now() ensures uniqueness across all browser tabs/sessions
  const newSessionId = Date.now();
  amplitude.setSessionId(newSessionId);

  // Step 4: Force a small async delay to ensure storage operations complete
  // and the SDK has processed the new session ID before tracking
  queueMicrotask(() => {
    // Step 5: Track the session start in the context of the new session
    // This event will be associated with the new session ID and new replay session
    amplitude.track("practice_replay_session_started", {
      new_session_id: newSessionId,
      timestamp_ms: newSessionId,
      ...metadata,
    });

    // Step 6: Flush again to ensure the session start event goes out
    amplitude.flush();

    console.log("[analytics] New practice replay session started", {
      session_id: newSessionId,
      user_id: currentUserId,
      metadata,
    });
  });
}
