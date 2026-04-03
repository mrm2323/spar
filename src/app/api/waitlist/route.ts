import { NextResponse } from "next/server";
import {
  ensureBetaApprovalRequest,
  normalizeBetaEmail,
} from "@/lib/beta-access";

const OK = { ok: true as const };
const FAIL = { ok: false as const };

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(FAIL, { status: 400 });
  }

  const raw =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof (body as { email: unknown }).email === "string"
      ? (body as { email: string }).email
      : "";

  if (!raw) {
    return NextResponse.json(FAIL, { status: 400 });
  }

  const email = normalizeBetaEmail(raw);
  if (!email.includes("@") || email.length > 254) {
    return NextResponse.json(FAIL, { status: 400 });
  }

  const ensured = await ensureBetaApprovalRequest(email);
  if (ensured.status === "none") {
    return NextResponse.json(FAIL, { status: 500 });
  }

  return NextResponse.json({
    ...OK,
    submitted: ensured.requestCreated || ensured.requestReopened,
    duplicate: !ensured.requestCreated && !ensured.requestReopened,
    status: ensured.status,
  });
}
