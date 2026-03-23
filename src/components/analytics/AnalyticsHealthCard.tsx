"use client";

import { useEffect, useState } from "react";
import { getAnalyticsClientStatus } from "@/lib/analytics";

type ServerHealth = {
  config?: {
    hasPublicApiKey?: boolean;
    allowedHostsEnv?: string;
  };
  network?: {
    eventsReachability?: { ok: boolean; status: number | null; error: string | null };
    replayTrackReachability?: { ok: boolean; status: number | null; error: string | null };
    replayConfigReachability?: { ok: boolean; status: number | null; error: string | null };
  };
};

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`}
      aria-hidden
    />
  );
}

export function AnalyticsHealthCard() {
  const [client] = useState(() => getAnalyticsClientStatus());
  const [server, setServer] = useState<ServerHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/amplitude/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: ServerHealth) => setServer(data))
      .catch(() => {
        setServer(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const keyReady = client.keyPresent && Boolean(server?.config?.hasPublicApiKey);
  const hostReady = client.hostAllowed;
  const networkReady =
    Boolean(server?.network?.eventsReachability?.ok) &&
    Boolean(server?.network?.replayTrackReachability?.ok) &&
    Boolean(server?.network?.replayConfigReachability?.ok);

  return (
    <section className="mt-10 rounded-xl border border-slate-700/60 bg-[#0b1d3e]/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Analytics health
        </h2>
        {loading ? (
          <span className="text-[11px] text-slate-500">Checking...</span>
        ) : (
          <span className="text-[11px] text-slate-400">Live diagnostic</span>
        )}
      </div>

      <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
        <p className="flex items-center gap-2 rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-2">
          <Dot ok={keyReady} />
          API key configured
        </p>
        <p className="flex items-center gap-2 rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-2">
          <Dot ok={hostReady} />
          Host allowed
        </p>
        <p className="flex items-center gap-2 rounded border border-slate-700/60 bg-slate-900/30 px-2.5 py-2">
          <Dot ok={networkReady} />
          Amplitude network reachable
        </p>
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-slate-400">
        <p>Host: {client.currentHost || "unknown"}</p>
        <p>
          Allowlist: {client.allowlist.length > 0 ? client.allowlist.join(", ") : "(not set - allow all hosts)"}
        </p>
        {!hostReady ? (
          <p className="text-rose-300">
            This hostname is currently blocked by NEXT_PUBLIC_AMPLITUDE_ALLOWED_HOSTS.
          </p>
        ) : null}
        {!keyReady ? (
          <p className="text-rose-300">
            NEXT_PUBLIC_AMPLITUDE_API_KEY is missing in active deployment environment.
          </p>
        ) : null}
        {server?.network?.eventsReachability?.error ? (
          <p className="text-rose-300">
            Upstream check error: {server.network.eventsReachability.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
