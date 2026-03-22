"use client";

import {
  identify,
  Identify,
  init,
  setUserId,
  track,
} from "@amplitude/analytics-browser";

let initialized = false;

function getApiKey(): string | null {
  const key = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  return key && key.trim().length > 0 ? key : null;
}

export function initAnalytics(userId?: string | null): void {
  const apiKey = getApiKey();
  if (!apiKey || initialized) {
    if (apiKey && userId) setUserId(userId);
    return;
  }

  init(apiKey, undefined, {
    defaultTracking: {
      sessions: true,
      pageViews: false,
      formInteractions: true,
      fileDownloads: false,
    },
  });

  if (userId) {
    setUserId(userId);
  }

  initialized = true;
}

export function setAnalyticsUser(userId: string | null | undefined): void {
  if (!userId) return;
  if (!getApiKey()) return;
  setUserId(userId);
}

export function identifyUser(properties: Record<string, string | number | boolean>): void {
  if (!getApiKey()) return;
  const id = new Identify();
  for (const [k, v] of Object.entries(properties)) {
    id.set(k, v);
  }
  identify(id);
}

export function trackEvent(
  eventName: string,
  eventProperties?: Record<string, unknown>
): void {
  if (!getApiKey()) return;
  track(eventName, eventProperties);
}
