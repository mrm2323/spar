import { Loader2 } from "lucide-react";

export default function HistoryLoading() {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-12 text-center">
      <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>loading practice history...</span>
      </div>
    </div>
  );
}
