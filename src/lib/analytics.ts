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
  "spar-ai.vercel.app"
)
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
let initialized = false;
let replayAttached = false;
let currentUserId: string | null = null;

function firstPartyUrl(pathname: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${pathname}`;
}

function hostAllowed(hostname: string): boolean {
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
  if (AMPLITUDE_API_KEY.length === 0) return false;
  return hostAllowed(window.location.hostname);
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
