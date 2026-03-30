import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>loading dashboard...</span>
    </div>
  );
}
