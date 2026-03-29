import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { normalizeBetaEmail } from "@/lib/beta-access";
import { notifyWaitlistSignup } from "@/lib/waitlist-notify";

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

  const supabase = createSupabaseAdmin();
  const { error } = await supabase.from("beta_waitlist").insert({
    email,
    status: "pending",
  });

  // 23505 = unique_violation — same email again; no email to owner
  if (error?.code === "23505") {
    return NextResponse.json({ ...OK, duplicate: true as const });
  }

  if (error) {
    console.error("[waitlist] insert:", error.message, error.code);
    return NextResponse.json(FAIL, { status: 500 });
  }

  void notifyWaitlistSignup(email).catch((err) => {
    console.error("[waitlist] notify email failed:", err);
  });

  return NextResponse.json({ ...OK, submitted: true as const });
}
