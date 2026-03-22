"use client";

/**
 * Analytics no-op until you wire Amplitude (or another provider).
 *
 * Later: `npm install @amplitude/analytics-browser`, set `NEXT_PUBLIC_AMPLITUDE_API_KEY`,
 * and replace this module with real `init` / `track` / `identify` calls.
 */

export function initAnalytics(_userId?: string | null): void {}

export function setAnalyticsUser(_userId: string | null | undefined): void {}

export function identifyUser(_properties: Record<string, string | number | boolean>): void {}

export function trackEvent(
  _eventName: string,
  _eventProperties?: Record<string, unknown>
): void {}
