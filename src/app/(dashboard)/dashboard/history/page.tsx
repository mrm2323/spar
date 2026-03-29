import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import Link from "next/link";
import { FileText, Clock, ArrowRight } from "lucide-react";

export default async function HistoryPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const supabase = createSupabaseAdmin();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(50);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">your practice history</h1>
        <p className="mt-1 text-slate-400">
          every call and kabir&apos;s take on it.
        </p>
      </div>

      {!sessions || sessions.length === 0 ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-12 text-center">
          <p className="text-slate-400">first time? tell kabir what&apos;s coming up.</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-cyan-400/95 hover:text-violet-300"
          >
            talk to kabir
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/notes/${session.id}`}
              className="group flex items-center justify-between rounded-2xl border border-slate-700/50 bg-slate-900/35 p-5 transition-all hover:border-cyan-500/35 hover:bg-slate-900/55"
            >
              <div>
                <h3 className="font-semibold">
                  {session.context
                    ? session.context.slice(0, 60) + (session.context.length > 60 ? "..." : "")
                    : "practice"}
                </h3>
                <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(session.duration_seconds)}
                  </span>
                  <span>
                    {session.ended_at ? new Date(session.ended_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-400 transition-colors group-hover:text-white">
                <FileText className="h-4 w-4" />
                kabir&apos;s take
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
