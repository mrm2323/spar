"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { identifyUser, initAnalytics, setAnalyticsUser, trackEvent } from "@/lib/analytics";

export function AmplitudeBootstrap() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, isLoaded } = useUser();
  const lastPathRef = useRef<string>("");

  useEffect(() => {
    if (!isLoaded) return;

    initAnalytics(user?.id ?? null);
    setAnalyticsUser(user?.id ?? null);
    if (user?.primaryEmailAddress?.emailAddress) {
      identifyUser({
        email_domain: user.primaryEmailAddress.emailAddress.split("@")[1] || "unknown",
      });
    }
  }, [isLoaded, user?.id, user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;

    type NavigatorWithConnection = Navigator & {
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
    };

    const nav = navigator as NavigatorWithConnection;

    const readConnectivity = () => ({
      online: navigator.onLine,
      effective_type: nav.connection?.effectiveType || "unknown",
      downlink_mbps: nav.connection?.downlink ?? -1,
      rtt_ms: nav.connection?.rtt ?? -1,
      save_data: Boolean(nav.connection?.saveData),
      host: window.location.hostname,
    });

    const emitSnapshot = (source: "init" | "online" | "offline" | "connection_change") => {
      trackEvent("client_connectivity_snapshot", {
        source,
        ...readConnectivity(),
      });
    };

    const onOnline = () => emitSnapshot("online");
    const onOffline = () => emitSnapshot("offline");
    const onConnectionChange = () => emitSnapshot("connection_change");

    emitSnapshot("init");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    nav.connection?.addEventListener?.("change", onConnectionChange);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      nav.connection?.removeEventListener?.("change", onConnectionChange);
    };
  }, [isLoaded]);

  useEffect(() => {
    const pathWithQuery = `${pathname || ""}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
    if (!pathWithQuery || lastPathRef.current === pathWithQuery) return;
    lastPathRef.current = pathWithQuery;

    trackEvent("page_view", {
      path: pathname || "",
      query: searchParams?.toString() || "",
    });
  }, [pathname, searchParams]);

  return null;
}
