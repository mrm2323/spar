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
