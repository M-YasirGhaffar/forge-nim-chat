"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="text-5xl font-semibold tracking-tight mb-2">Something broke</div>
        <p className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
          {error.message || "An unexpected error occurred."}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={() => reset()} className="btn btn-primary">Try again</button>
          <Link href="/chat" className="btn btn-secondary">Back to chat</Link>
        </div>
      </div>
    </main>
  );
}
