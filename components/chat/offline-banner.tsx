"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Sticky top banner shown when the browser reports no network. We hide it during
 * SSR (window is undefined) and rely on online/offline events thereafter.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOffline(!navigator.onLine);
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 w-full bg-[rgb(var(--color-warning)/0.15)] border-b border-[rgb(var(--color-warning)/0.4)]"
    >
      <div className="mx-auto max-w-3xl px-4 py-2 text-[12px] flex items-center gap-2" style={{ color: "rgb(var(--color-fg))" }}>
        <WifiOff className="h-3.5 w-3.5" style={{ color: "rgb(var(--color-warning))" }} />
        <span>You&apos;re offline. Messages will not send until your connection returns.</span>
      </div>
    </div>
  );
}
