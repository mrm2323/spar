import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  getMemoryPreference,
  setMemoryPreference,
} from "@/lib/memory/preferences";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getMemoryPreference(userId);
  return NextResponse.json({ enabled });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { enabled } = (await req.json()) as { enabled: boolean };
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  }

  await setMemoryPreference(userId, enabled);
  return NextResponse.json({ ok: true, enabled });
}
