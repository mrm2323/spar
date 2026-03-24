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
let lastPracticeReplayKey: string | null = null;

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
  if (!canSendAnalytics() || initialized) {
    console.log("[analytics] Init skipped", {
      canSend: canSendAnalytics(),
      alreadyInit: initialized,
    });
    return;
  }

  const eventsServerUrl = AMPLITUDE_EVENTS_SERVER_URL || firstPartyUrl("/api/amplitude/events");
  const replayTrackServerUrl =
    AMPLITUDE_REPLAY_TRACK_SERVER_URL || firstPartyUrl("/api/amplitude/replay-track");
  const replayConfigServerUrl =
    AMPLITUDE_REPLAY_CONFIG_SERVER_URL || firstPartyUrl("/api/amplitude/replay-config");

  console.log("[analytics] Initializing with URLs", {
    userId,
    eventsServerUrl,
    replayTrackServerUrl,
    replayConfigServerUrl,
  });

  if (!replayAttached) {
    try {
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
      console.log("[analytics] Replay plugin attached successfully");
    } catch (e) {
      console.error("[analytics] Failed to attach replay plugin", e);
      replayAttached = false;
    }
  }

  try {
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

    console.log("[analytics] Initialized successfully", {
      userId,
      replayAttached,
    });
  } catch (e) {
    console.error("[analytics] Failed to initialize Amplitude", e);
    initialized = false;
  }
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

export function startPracticeReplaySession(
  metadata?: Record<string, unknown>
): void {
  if (!canSendAnalytics()) {
    console.warn("[analytics] Cannot send analytics, skipping session start");
    return;
  }

  const metadataSessionId =
    typeof metadata?.session_id === "string" ? metadata.session_id : null;

  // Avoid duplicate replay rotations for the same practice session.
  if (metadataSessionId && metadataSessionId === lastPracticeReplayKey) {
    console.log("[analytics] Skipping duplicate replay rotation", {
      session_id: metadataSessionId,
    });
    return;
  }

  console.log("[analytics] === Starting new practice replay session ===", {
    current_user: currentUserId,
    replay_attached: replayAttached,
    initialized,
    metadata,
  });

  try {
    // Flush old session events before rotating.
    amplitude.flush();

    // Ensure replay session ownership is attached to the authenticated user.
    if (currentUserId) {
      amplitude.setUserId(currentUserId);
    }

    // Start a new Amplitude session boundary used by Replay.
    const newSessionId = Date.now();
    amplitude.setSessionId(newSessionId);
    console.log("[analytics] Session ID updated:", newSessionId);

    // Track a deterministic marker that links practice session ID to replay session.
    amplitude.track("practice_session_started", {
      practice_session_id: metadataSessionId,
      session_id: newSessionId,
      timestamp: Date.now(),
      ...metadata,
    });

    // Flush immediately
    amplitude.flush();

    console.log("[analytics] === READY ===", {
      session_id: newSessionId,
      user_id: currentUserId,
    });

    if (metadataSessionId) {
      lastPracticeReplayKey = metadataSessionId;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[analytics] ERROR:", errMsg);
  }
}
