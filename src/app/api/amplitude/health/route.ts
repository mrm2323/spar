import { NextResponse } from "next/server";

const EVENTS_UPSTREAM_URL =
  process.env.AMPLITUDE_EVENTS_UPSTREAM_URL?.trim() ||
  "https://api2.amplitude.com/2/httpapi";
const REPLAY_TRACK_UPSTREAM_URL =
  process.env.AMPLITUDE_REPLAY_TRACK_UPSTREAM_URL?.trim() ||
  "https://api-sr.amplitude.com/sessions/v2/track";
const REPLAY_CONFIG_UPSTREAM_URL =
  process.env.AMPLITUDE_REPLAY_CONFIG_UPSTREAM_URL?.trim() ||
  "https://sr-client-cfg.amplitude.com/config";

async function checkReachability(url: string): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
}> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    return {
      ok: res.ok,
      status: res.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

async function checkEventsIngest(apiKey: string): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
}> {
  try {
    const res = await fetch(EVENTS_UPSTREAM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        events: [
          {
            user_id: "health-check-user",
            event_type: "health_check",
            time: Date.now(),
            event_properties: { source: "spar_health" },
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    return {
      ok: res.ok,
      status: res.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

async function checkReplayTrack(apiKey: string): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
}> {
  try {
    const target = `${REPLAY_TRACK_UPSTREAM_URL}?device_id=health-check-device&session_id=${Date.now()}&type=replay`;
    const res = await fetch(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        version: 1,
        events: [{ type: "replay", data: "{}" }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    return {
      ok: res.ok,
      status: res.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

async function checkReplayConfig(apiKey: string): Promise<{
  ok: boolean;
  status: number | null;
  error: string | null;
}> {
  try {
    const target = `${REPLAY_CONFIG_UPSTREAM_URL}?api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(target, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    return {
      ok: res.ok,
      status: res.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY?.trim() || "";

  const [eventsReachability, replayTrackReachability, replayConfigReachability] =
    apiKey
      ? await Promise.all([
          checkEventsIngest(apiKey),
          checkReplayTrack(apiKey),
          checkReplayConfig(apiKey),
        ])
      : await Promise.all([
          checkReachability("https://api2.amplitude.com"),
          checkReachability("https://api-sr.amplitude.com"),
          checkReachability(REPLAY_CONFIG_UPSTREAM_URL),
        ]);

  return NextResponse.json(
    {
      ok: true,
      serverTime: new Date().toISOString(),
      config: {
        hasPublicApiKey: Boolean(process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY?.trim()),
        allowedHostsEnv: process.env.NEXT_PUBLIC_AMPLITUDE_ALLOWED_HOSTS || "",
        eventsUpstreamUrl: EVENTS_UPSTREAM_URL,
        replayTrackUpstreamUrl: REPLAY_TRACK_UPSTREAM_URL,
        replayConfigUpstreamUrl: REPLAY_CONFIG_UPSTREAM_URL,
      },
      network: {
        eventsReachability,
        replayTrackReachability,
        replayConfigReachability,
      },
      proxyRoutes: {
        events: "/api/amplitude/events",
        replayTrack: "/api/amplitude/replay-track",
        replayConfig: "/api/amplitude/replay-config",
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    }
  );
}
