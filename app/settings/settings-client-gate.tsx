"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export function SettingsClientGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login?next=/settings");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="h-screen grid place-items-center">
        <div className="shimmer h-3 w-32 rounded" />
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}

export function SettingsAccountLine({ ssrEmail }: { ssrEmail?: string | null }) {
  const { user } = useAuth();
  const email = user?.email || ssrEmail || "your account";
  return (
    <>
      Signed in as <strong>{email}</strong>
    </>
  );
}
