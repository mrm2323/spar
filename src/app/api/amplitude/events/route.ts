import { NextRequest, NextResponse } from "next/server";

const EVENTS_UPSTREAM_URL =
  process.env.AMPLITUDE_EVENTS_UPSTREAM_URL?.trim() ||
  "https://api2.amplitude.com/2/httpapi";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.text();
    const contentType = request.headers.get("content-type") || "application/json";

    const upstream = await fetch(EVENTS_UPSTREAM_URL, {
      method: "POST",
      headers: {
        "content-type": contentType,
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
    console.error("[amplitude proxy] events forward failed", error);
    return NextResponse.json(
      { error: "amplitude_events_proxy_failed" },
      { status: 502 }
    );
  }
}
