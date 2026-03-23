import { NextRequest, NextResponse } from "next/server";

const REPLAY_CONFIG_UPSTREAM_BASE_URL =
  process.env.AMPLITUDE_REPLAY_CONFIG_UPSTREAM_BASE_URL?.trim() ||
  "https://sr-client-cfg.amplitude.com";

function joinUrl(base: string, path: string, search: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}${search}`;
}

async function forward(
  request: NextRequest,
  pathSegments: string[]
): Promise<NextResponse> {
  try {
    const forwardedPath = pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "/config";
    const targetUrl = joinUrl(
      REPLAY_CONFIG_UPSTREAM_BASE_URL,
      forwardedPath,
      request.nextUrl.search
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

    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
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
