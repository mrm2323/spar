import { NextRequest, NextResponse } from "next/server";

const REPLAY_CONFIG_UPSTREAM_BASE_URL =
  process.env.AMPLITUDE_REPLAY_CONFIG_UPSTREAM_BASE_URL?.trim() ||
  "https://sr-client-cfg.amplitude.com";

function joinUrl(base: string, path: string, search: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}${search}`;
}

function extractApiKeyFromPath(path: string): string | undefined {
  const decoded = decodeURIComponent(path);

  // Common SDK shape: /api/<apiKey>~
  const apiKeyTildeMatch = decoded.match(/^\/api\/([^/]+?)~(?:.*)?$/);
  if (apiKeyTildeMatch?.[1]) {
    return apiKeyTildeMatch[1];
  }

  // Fallback: detect a 32-char hex key anywhere in path.
  const hexKeyMatch = decoded.match(/([a-f0-9]{32})/i);
  if (hexKeyMatch?.[1]) {
    return hexKeyMatch[1];
  }

  return undefined;
}

function mapReplayConfigPath(path: string): { path: string; apiKeyFromPath?: string } {
  // The web SDK can request replay config via /api/* style paths,
  // but Amplitude's replay config host serves this at /config.
  const apiKeyFromPath = extractApiKeyFromPath(path);
  if (apiKeyFromPath) {
    return { path: "/config", apiKeyFromPath };
  }

  if (path === "/api" || path.startsWith("/api/")) return { path: "/config" };
  if (path === "/api/v1/config") return { path: "/config" };
  if (path.startsWith("/api/v1/config/")) {
    return { path: path.replace("/api/v1/config", "/config") };
  }
  return { path };
}

async function forward(
  request: NextRequest,
  pathSegments: string[]
): Promise<NextResponse> {
  try {
    const requestedPath = pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "/config";
    const mapped = mapReplayConfigPath(requestedPath);
    const forwardedPath = mapped.path;
    const query = new URLSearchParams(request.nextUrl.searchParams);
    if (mapped.apiKeyFromPath && !query.get("api_key")) {
      query.set("api_key", mapped.apiKeyFromPath);
    }
    const search = query.toString() ? `?${query.toString()}` : "";
    const targetUrl = joinUrl(
      REPLAY_CONFIG_UPSTREAM_BASE_URL,
      forwardedPath,
      search
    );

    const body = request.method === "POST" ? await request.text() : undefined;
    const contentType = request.headers.get("content-type");

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
    });

    const responseBody = await upstream.text();

    // Safety net: if upstream says API key is missing, retry once by extracting
    // from path with a broad regex (some SDK variants embed it oddly).
    if (
      upstream.status === 403 &&
      responseBody.includes("Missing API key") &&
      !query.get("api_key")
    ) {
      const recoveredKey = extractApiKeyFromPath(requestedPath);
      if (recoveredKey) {
        const retryQuery = new URLSearchParams(query);
        retryQuery.set("api_key", recoveredKey);
        const retrySearch = retryQuery.toString() ? `?${retryQuery.toString()}` : "";
        const retryUrl = joinUrl(REPLAY_CONFIG_UPSTREAM_BASE_URL, "/config", retrySearch);

        const retryUpstream = await fetch(retryUrl, {
          method: request.method,
          headers: {
            ...(contentType ? { "content-type": contentType } : {}),
          },
          ...(body ? { body } : {}),
          cache: "no-store",
        });

        const retryBody = await retryUpstream.text();
        return new NextResponse(retryBody, {
          status: retryUpstream.status,
          headers: {
            "content-type": retryUpstream.headers.get("content-type") || "application/json",
            "cache-control": "no-store",
            "x-replay-config-forwarded-path": "/config",
            "x-replay-config-has-api-key": "yes",
          },
        });
      }
    }

    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
        "x-replay-config-requested-path": requestedPath,
        "x-replay-config-forwarded-path": forwardedPath,
        "x-replay-config-has-api-key": query.get("api_key") ? "yes" : "no",
        "x-replay-config-api-key-from-path": mapped.apiKeyFromPath ? "yes" : "no",
      },
    });
  } catch (error) {
    console.error("[amplitude proxy] replay config catch-all forward failed", error);
    return NextResponse.json(
      { error: "amplitude_replay_config_proxy_failed" },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const resolved = await params;
  return forward(request, resolved.path || []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  const resolved = await params;
  return forward(request, resolved.path || []);
}
