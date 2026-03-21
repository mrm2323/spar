"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EarlyAccessForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("submitting");

    try {
      const formData = new FormData();
      formData.append("email", email);

      // Submit directly so we don't navigate away to Formspree.
      await fetch("https://formspree.io/f/maqpbppn", {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      setStatus("success");
      router.push("/dashboard");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to submit");
    }
  }

  return (
    <div className="mt-12 w-full max-w-sm">
      <form onSubmit={onSubmit} className="flex w-full gap-2">
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="whitespace-nowrap rounded-lg bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-60"
        >
          {status === "submitting" ? "Submitting..." : "Get early access"}
        </button>
      </form>

      <div className="mt-3 text-xs text-zinc-600">
        <button
          type="button"
          onClick={() => router.push("/sign-in")}
          className="hover:text-zinc-300"
        >
          Prefer to start now? Sign in.
        </button>
      </div>

      {status === "error" && (
        <p className="mt-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

