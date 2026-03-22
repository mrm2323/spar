import { NextRequest, NextResponse } from "next/server";

const REPLAY_TRACK_UPSTREAM_URL =
  process.env.AMPLITUDE_REPLAY_TRACK_UPSTREAM_URL?.trim() ||
  "https://api-sr.amplitude.com/sessions/v2/track";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    const contentType = request.headers.get("content-type") || "application/json";
    const authorization = request.headers.get("authorization");
    const targetUrl = `${REPLAY_TRACK_UPSTREAM_URL}${request.nextUrl.search}`;

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
    console.error("[amplitude proxy] replay track forward failed", error);
    return NextResponse.json(
      { error: "amplitude_replay_track_proxy_failed" },
      { status: 502 }
    );
  }
}
