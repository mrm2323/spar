import { NextRequest, NextResponse } from "next/server";

const REPLAY_CONFIG_UPSTREAM_URL =
  process.env.AMPLITUDE_REPLAY_CONFIG_UPSTREAM_URL?.trim() ||
  "https://sr-client-cfg.amplitude.com/config";

function buildTargetUrl(request: NextRequest): string {
  return `${REPLAY_CONFIG_UPSTREAM_URL}${request.nextUrl.search}`;
}

async function forward(
  request: NextRequest,
  method: "GET" | "POST"
): Promise<NextResponse> {
  try {
    const targetUrl = buildTargetUrl(request);
    const body = method === "POST" ? await request.text() : undefined;
    const contentType = request.headers.get("content-type");

    const upstream = await fetch(targetUrl, {
      method,
      headers: {
        ...(contentType ? { "content-type": contentType } : {}),
      },
      ...(body ? { body } : {}),
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
    console.error("[amplitude proxy] replay config forward failed", error);
    return NextResponse.json(
      { error: "amplitude_replay_config_proxy_failed" },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return forward(request, "GET");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return forward(request, "POST");
}
