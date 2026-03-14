"use client";

import { useState } from "react";

export function ShareLink() {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <button
      onClick={handleShare}
      className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
    >
      {copied ? "Link copied!" : "Know someone who needs Kabir? Share this."}
    </button>
  );
}
