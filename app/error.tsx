"use client";

import { RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#f7f4ee] px-4 py-6 text-[#151414]">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
        <section className="w-full max-w-lg rounded-lg border border-[#ded8cc] bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#b4472f]">
            Sprint interrupted
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Something went wrong.</h1>
          <p className="mt-3 text-sm leading-6 text-[#5d5a54]">
            The round could not be loaded. Reset the screen to start a fresh
            sprint.
          </p>
          {error.message ? (
            <p className="mt-4 rounded border border-[#efd1c7] bg-[#fff4f0] p-3 text-sm text-[#7d2f1f]">
              {error.message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-[#151414] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2b2926] focus:outline-none focus:ring-2 focus:ring-[#151414] focus:ring-offset-2"
          >
            <RotateCcw aria-hidden="true" size={16} />
            Reset
          </button>
        </section>
      </div>
    </main>
  );
}
