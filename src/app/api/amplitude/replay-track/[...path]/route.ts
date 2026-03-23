import { NextRequest, NextResponse } from "next/server";

const REPLAY_TRACK_UPSTREAM_BASE_URL =
  process.env.AMPLITUDE_REPLAY_TRACK_UPSTREAM_BASE_URL?.trim() ||
  "https://api-sr.amplitude.com";

function joinUrl(base: string, path: string, search: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}${search}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
): Promise<NextResponse> {
  try {
    const resolved = await params;
    const pathSegments = resolved.path || [];
    const forwardedPath =
      pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "/sessions/v2/track";
    const targetUrl = joinUrl(
      REPLAY_TRACK_UPSTREAM_BASE_URL,
      forwardedPath,
      request.nextUrl.search
    );

    const body = await request.text();
    const contentType = request.headers.get("content-type") || "application/json";
    const authorization = request.headers.get("authorization");

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": contentType,
        ...(authorization ? { authorization } : {}),
      },
      body,
      cache: "no-store",
    });

    const responseBody = await upstream.text();

    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("[amplitude proxy] replay track catch-all forward failed", error);
    return NextResponse.json(
      { error: "amplitude_replay_track_proxy_failed" },
      { status: 502 }
    );
  }
}
