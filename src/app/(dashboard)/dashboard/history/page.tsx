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
        <h1 className="text-2xl font-bold">Past Sessions</h1>
        <p className="mt-1 text-zinc-500">
          Your sessions and Kabir&apos;s notes.
        </p>
      </div>

      {!sessions || sessions.length === 0 ? (
        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-12 text-center">
          <p className="text-zinc-500">No completed sessions yet.</p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-white hover:text-zinc-300"
          >
            Start your first session
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/notes/${session.id}`}
              className="group flex items-center justify-between rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-5 transition-all hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <div>
                <h3 className="font-semibold">
                  {session.context
                    ? session.context.slice(0, 60) + (session.context.length > 60 ? "..." : "")
                    : "Open session"}
                </h3>
                <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(session.duration_seconds)}
                  </span>
                  <span>
                    {session.ended_at ? new Date(session.ended_at).toLocaleDateString() : ""}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-500 transition-colors group-hover:text-white">
                <FileText className="h-4 w-4" />
                Kabir&apos;s Notes
                <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
