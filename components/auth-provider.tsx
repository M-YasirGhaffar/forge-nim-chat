"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  idToken: string | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthContextValue>({
  user: null,
  loading: true,
  idToken: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(Ctx);
}

/** POST the current ID token to the session endpoint so SSR cookie stays in sync. */
async function syncSessionCookie(idToken: string): Promise<void> {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  }).catch(() => {});
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [idToken, setIdToken] = useState<string | null>(null);

  useEffect(() => {
    const auth = getClientAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        const tok = await u.getIdToken();
        setIdToken(tok);
        // Sync session cookie so SSR pages see the user.
        await syncSessionCookie(tok);
      } else {
        setIdToken(null);
        await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
      }
    });

    // Refresh ID token periodically (Firebase rotates ~every 60 minutes).
    // Re-POST the session cookie too — this gives us 7-day rolling refresh on the server side.
    const interval = setInterval(async () => {
      const u = getClientAuth().currentUser;
      if (u) {
        const tok = await u.getIdToken(true);
        setIdToken(tok);
        await syncSessionCookie(tok);
      }
    }, 50 * 60 * 1000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        idToken,
        signOut: async () => {
          await fbSignOut(getClientAuth());
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export async function authedFetch(
  url: string,
  init: RequestInit & { idToken?: string | null } = {}
): Promise<Response> {
  async function call(forceRefresh: boolean): Promise<Response> {
    let token = init.idToken;
    if (token === undefined) {
      const u = getClientAuth().currentUser;
      token = u ? await u.getIdToken(forceRefresh) : null;
    }
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    const cleanInit: RequestInit = { ...init, headers };
    delete (cleanInit as { idToken?: string | null }).idToken;
    return fetch(url, cleanInit);
  }

  // First attempt with cached token. Single-attempt only — never recurse.
  const res = await call(false);
  if (res.status !== 401) return res;
  // 401 → token may have rotated; force-refresh and retry exactly once.
  if (init.idToken !== undefined) return res; // explicit token passed — don't second-guess
  const u = getClientAuth().currentUser;
  if (!u) return res;
  // Force-refresh, retry once. The retry uses forceRefresh=true so we get a fresh token,
  // but we deliberately do NOT loop on a second 401 (prevents infinite recursion).
  const retryRes = await call(true);
  // After a successful force-refresh, re-POST the session cookie too so SSR pages stay in sync.
  if (retryRes.status !== 401) {
    try {
      const fresh = await u.getIdToken(false);
      // Fire and forget; don't block the caller's response.
      void fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: fresh }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }
  return retryRes;
}
