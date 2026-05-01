"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  type User,
} from "firebase/auth";
import { getClientAuth } from "@/lib/firebase/client";
import { useAuth } from "@/components/auth-provider";
import { toast } from "sonner";
import Link from "next/link";
import { Mail, Loader2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { BrandLogo, BrandName } from "@/components/brand";

/**
 * After any successful sign-in, post the fresh ID token to /api/auth/session so the
 * SSR cookie is set before we navigate. Without this, server-rendered redirects on
 * the next page (e.g. /login → /chat from getSessionUser) can't see the session yet
 * and the user briefly bounces back to /login.
 */
async function syncSession(user: User): Promise<void> {
  try {
    const idToken = await user.getIdToken();
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    // Best-effort — auth-provider's listener will retry on next tick.
  }
}

type Mode = "signin" | "signup" | "magic-link" | "reset";

/**
 * Sanitize the `next` query param so an attacker can't redirect users to an external URL.
 * Only same-origin paths starting with a single "/" (and not "//" or "/\") are allowed.
 */
function safeNext(n: string | null | undefined): string {
  if (!n) return "/chat";
  if (!n.startsWith("/") || n.startsWith("//") || n.startsWith("/\\")) return "/chat";
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"" | "google" | "submit" | "email-complete">("");
  const [linkSent, setLinkSent] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null);
  const next = safeNext(sp.get("next"));

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  // Handle email-link callback. We must (a) complete the sign-in, (b) sync the SSR
  // cookie, and (c) THEN navigate — otherwise the destination page does its own auth
  // check on a stale session and the loading shimmer never clears.
  useEffect(() => {
    const auth = getClientAuth();
    const url = window.location.href;
    if (!isSignInWithEmailLink(auth, url)) return;

    const stored = window.localStorage.getItem("emailForSignIn") || "";
    if (!stored) {
      // Cross-device handoff: user opened the link on a different device.
      setPendingLinkUrl(url);
      setNeedsEmailConfirm(true);
      return;
    }

    let cancelled = false;
    setBusy("email-complete");
    (async () => {
      try {
        const cred = await signInWithEmailLink(auth, stored, url);
        window.localStorage.removeItem("emailForSignIn");
        await syncSession(cred.user);
        if (cancelled) return;
        toast.success("Signed in.");
        // Strip the auth params from the URL before navigating so a back-button press
        // doesn't try to re-consume an already-redeemed magic link.
        window.history.replaceState({}, "", "/login");
        setBusy("");
        router.replace(next);
      } catch (err) {
        if (cancelled) return;
        toast.error(friendlyAuthError(err));
        setBusy("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, next]);

  // Safety net: if the auth listener completes (user is set) while we're still
  // in any "busy" state, clear it. Prevents a stuck spinner if router.replace
  // doesn't unmount us in time.
  useEffect(() => {
    if (user && busy) setBusy("");
  }, [user, busy]);

  async function handleConfirmEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = confirmEmail.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }
    if (!pendingLinkUrl) return;
    setBusy("email-complete");
    try {
      const cred = await signInWithEmailLink(getClientAuth(), trimmed, pendingLinkUrl);
      window.localStorage.removeItem("emailForSignIn");
      await syncSession(cred.user);
      toast.success("Signed in.");
      window.history.replaceState({}, "", "/login");
      router.replace(next);
    } catch (err) {
      toast.error(friendlyAuthError(err));
      setBusy("");
    }
  }

  async function signInWithGoogle() {
    setBusy("google");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const cred = await signInWithPopup(getClientAuth(), provider);
      // Same sync-then-navigate dance as email-link — the SSR cookie has to be set
      // before we let Next.js render the destination route.
      await syncSession(cred.user);
      toast.success("Welcome.");
      router.replace(next);
    } catch (err) {
      const e = err as { code?: string };
      // Don't toast on user-initiated cancellations (popup closed / blocked is already toasted).
      if (e?.code !== "auth/popup-closed-by-user" && e?.code !== "auth/cancelled-popup-request") {
        toast.error(friendlyAuthError(err));
      }
    } finally {
      setBusy("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy("submit");
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(getClientAuth(), email, password);
        toast.success("Welcome back.");
      } else if (mode === "signup") {
        if (password.length < 8) {
          toast.error("Password must be at least 8 characters.");
          return;
        }
        const cred = await createUserWithEmailAndPassword(getClientAuth(), email, password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
        toast.success("Account created. Welcome.");
      } else if (mode === "magic-link") {
        // Defensive: re-validate `next` here in case the local var was mutated.
        const safeRedirect = safeNext(next);
        await sendSignInLinkToEmail(getClientAuth(), email, {
          url: `${window.location.origin}/login?next=${encodeURIComponent(safeRedirect)}`,
          handleCodeInApp: true,
        });
        window.localStorage.setItem("emailForSignIn", email);
        setLinkSent(true);
        toast.success("Check your inbox for a sign-in link.");
      } else if (mode === "reset") {
        await sendPasswordResetEmail(getClientAuth(), email);
        toast.success("Password-reset email sent.");
        setMode("signin");
      }
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setBusy("");
    }
  }

  // Cross-device email-link confirmation card.
  if (needsEmailConfirm) {
    return (
      <main className="min-h-screen flex flex-col">
        <header className="border-b">
          <div className="mx-auto max-w-6xl px-6 h-14 flex items-center">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <BrandLogo size={26} />
              <BrandName />
            </Link>
          </div>
        </header>
        <div className="flex-1 grid place-items-center px-6 py-12">
          <div className="card w-full max-w-md p-7 shadow-2xl">
            <h1 className="text-2xl font-semibold tracking-tight">Confirm your email</h1>
            <p className="mt-1 text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
              Confirm the email you used to request this sign-in link.
            </p>
            <form onSubmit={handleConfirmEmailSubmit} className="space-y-3 mt-5">
              <Field label="Email address">
                <input
                  type="email"
                  className="input h-11"
                  placeholder="you@example.com"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  required
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                />
              </Field>
              <button
                type="submit"
                className="btn btn-primary w-full h-11"
                disabled={busy === "email-complete" || !EMAIL_RE.test(confirmEmail.trim())}
              >
                {busy === "email-complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeedsEmailConfirm(false);
                  setPendingLinkUrl(null);
                  setConfirmEmail("");
                }}
                className="w-full text-xs text-center mt-1"
                style={{ color: "rgb(var(--color-fg-muted))" }}
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <BrandLogo size={26} />
            <BrandName />
          </Link>
        </div>
      </header>

      <div className="flex-1 grid place-items-center px-6 py-12">
        <div className="card w-full max-w-md p-7 shadow-2xl">
          {mode !== "signin" && mode !== "signup" && (
            <button
              onClick={() => setMode("signin")}
              className="btn btn-ghost h-7 px-2 -ml-2 mb-2 text-[12px]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          )}

          {(mode === "signin" || mode === "signup") && (
            <div className="flex items-center gap-1 rounded-lg border bg-[rgb(var(--color-bg-soft))] p-0.5 mb-5">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={tabClass(mode === "signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={tabClass(mode === "signup")}
              >
                Create account
              </button>
            </div>
          )}

          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "signin" && "Welcome back"}
            {mode === "signup" && "Create your account"}
            {mode === "magic-link" && "Get a sign-in link"}
            {mode === "reset" && "Reset your password"}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
            {mode === "signin" && "Sign in to continue your chats."}
            {mode === "signup" && "Free trial — no credit card."}
            {mode === "magic-link" && "We'll email you a one-time link. Open it on this device."}
            {mode === "reset" && "Enter your email and we'll send you a reset link."}
          </p>

          {(mode === "signin" || mode === "signup") && (
            <button
              onClick={signInWithGoogle}
              disabled={busy !== ""}
              className="btn btn-secondary w-full mt-5 h-11"
            >
              {busy === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon className="h-4 w-4" />
              )}
              Continue with Google
            </button>
          )}

          {(mode === "signin" || mode === "signup") && (
            <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider" style={{ color: "rgb(var(--color-fg-subtle))" }}>
              <div className="flex-1 border-t" />
              <span>or</span>
              <div className="flex-1 border-t" />
            </div>
          )}

          {linkSent ? (
            <div className="rounded-lg border bg-[rgb(var(--color-bg-soft))] p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Mail className="h-4 w-4" /> Sign-in link sent
              </div>
              <p className="mt-1.5" style={{ color: "rgb(var(--color-fg-muted))" }}>
                Open the email on this device and click the link to finish signing in.
              </p>
              <button
                onClick={() => { setLinkSent(false); setEmail(""); setMode("signin"); }}
                className="btn btn-ghost mt-3 h-7 px-2 text-xs -ml-2"
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <Field label="Display name (optional)">
                  <input
                    type="text"
                    className="input h-11"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    maxLength={80}
                  />
                </Field>
              )}
              <Field label="Email address">
                <input
                  type="email"
                  className="input h-11"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  inputMode="email"
                />
              </Field>
              {(mode === "signin" || mode === "signup") && (
                <Field
                  label="Password"
                  trailing={
                    mode === "signin" ? (
                      <button
                        type="button"
                        onClick={() => setMode("reset")}
                        className="text-[11px] underline"
                        style={{ color: "rgb(var(--color-fg-muted))" }}
                      >
                        Forgot password?
                      </button>
                    ) : null
                  }
                >
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="input h-11 pr-10"
                      placeholder={mode === "signup" ? "At least 8 characters" : ""}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      minLength={mode === "signup" ? 8 : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost h-7 w-7 p-0"
                      tabIndex={-1}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </Field>
              )}

              <button type="submit" className="btn btn-primary w-full h-11" disabled={busy !== "" || !email}>
                {busy === "submit" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "magic-link" ? (
                  <Mail className="h-4 w-4" />
                ) : null}
                {mode === "signin" && "Sign in"}
                {mode === "signup" && "Create account"}
                {mode === "magic-link" && "Email me a sign-in link"}
                {mode === "reset" && "Send reset link"}
              </button>

              {(mode === "signin" || mode === "signup") && (
                <button
                  type="button"
                  onClick={() => setMode("magic-link")}
                  className="w-full text-xs text-center mt-1"
                  style={{ color: "rgb(var(--color-fg-muted))" }}
                >
                  or sign in with a one-time email link
                </button>
              )}
            </form>
          )}

          <p className="mt-5 text-xs" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            We never share your email.
          </p>
        </div>
      </div>

      {busy === "email-complete" && (
        <div className="fixed inset-0 grid place-items-center backdrop-blur-sm bg-black/20">
          <div className="card p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            Signing you in…
          </div>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium" style={{ color: "rgb(var(--color-fg-muted))" }}>
          {label}
        </label>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function tabClass(active: boolean): string {
  return [
    "flex-1 rounded-md py-1.5 text-[13px] transition-colors",
    active
      ? "bg-[rgb(var(--color-bg-elev))] border border-[rgb(var(--color-border))] font-medium"
      : "text-[rgb(var(--color-fg-muted))] hover:text-[rgb(var(--color-fg))]",
  ].join(" ");
}

/** Map Firebase's auth/* error codes to actually-helpful copy. */
function friendlyAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code || "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Invalid email or password.";
    case "auth/email-already-in-use":
      return "An account with that email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 8 characters.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in cancelled.";
    case "auth/popup-blocked":
      return "Pop-up blocked by your browser. Allow pop-ups for this site.";
    case "auth/unauthorized-domain":
      return "This domain isn't authorized for sign-in. Add it under Firebase Console → Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't enabled. Open the Firebase console and turn it on under Authentication → Sign-in method.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    default:
      return e?.message || "Sign-in failed. Please try again.";
  }
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.227c0-.708-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-2 3.018v2.51h3.235c1.89-1.745 2.983-4.31 2.983-7.351z"/>
      <path fill="#34A853" d="M12 22c2.7 0 4.964-.895 6.618-2.422l-3.236-2.51c-.895.6-2.04.954-3.382.954-2.604 0-4.81-1.755-5.595-4.118H3.064v2.59A9.998 9.998 0 0 0 12 22z"/>
      <path fill="#FBBC04" d="M6.405 13.904a5.99 5.99 0 0 1 0-3.808V7.504H3.064a10.018 10.018 0 0 0 0 8.99l3.341-2.59z"/>
      <path fill="#EA4335" d="M12 5.977c1.468 0 2.786.504 3.823 1.495l2.868-2.868C16.96 2.992 14.696 2 12 2A9.998 9.998 0 0 0 3.064 7.504l3.341 2.591C7.19 7.732 9.395 5.977 12 5.977z"/>
    </svg>
  );
}

