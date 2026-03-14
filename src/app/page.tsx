export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-[#0A0A0F] px-6 py-16 text-white">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="mb-16 font-mono text-xs tracking-[0.3em] text-zinc-600">
          SPAR
        </p>

        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Call Kabir before the conversation you&apos;re avoiding.
        </h1>

        <p className="mt-6 max-w-md text-base leading-relaxed text-zinc-500">
          He&apos;ll become the other person. He&apos;ll push you.
          Then he&apos;ll tell you exactly what to fix.
        </p>

        <div className="mt-10 space-y-1.5 text-sm text-zinc-600">
          <p>Your roommate talk.</p>
          <p>Your salary ask.</p>
          <p>The thing you&apos;ve been putting off.</p>
        </div>

        <form
          action="https://formspree.io/f/maqpbppn"
          method="POST"
          className="mt-12 flex w-full max-w-sm gap-2"
        >
          <input
            type="email"
            name="email"
            required
            placeholder="your@email.com"
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-colors focus:border-zinc-600"
          />
          <button
            type="submit"
            className="whitespace-nowrap rounded-lg bg-white px-5 py-3 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            Get early access
          </button>
        </form>
      </div>

      <p className="mt-16 text-xs text-zinc-700">
        Built for international students navigating a new world.
      </p>
    </div>
  );
}
