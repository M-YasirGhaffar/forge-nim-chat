import { getSessionUser } from "@/lib/firebase/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { SettingsForm } from "./settings-form";
import { SettingsClientGate, SettingsAccountLine } from "./settings-client-gate";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings — Polyglot" };

export default async function SettingsPage() {
  const user = await getSessionUser().catch(() => null);

  let prefs: { lastModel?: string; thinkingDefault?: string; theme?: string } = {};
  const stats = { totalMessages: 0, totalTokens: 0 };
  let displayName = user?.name || "";
  if (user) {
    try {
      const snap = await getAdminDb().collection("users").doc(user.uid).get();
      if (snap.exists) {
        prefs = snap.get("preferences") || {};
        stats.totalMessages = (snap.get("totalMessagesAllTime") as number) || 0;
        stats.totalTokens = (snap.get("totalTokensAllTime") as number) || 0;
        displayName = (snap.get("displayName") as string) || displayName;
      }
    } catch {
      // ignore
    }
  }

  return (
    <SettingsClientGate>
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-6 h-14 flex items-center gap-3">
          <Link href="/chat" className="btn btn-ghost h-8 px-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="font-semibold">Settings</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl w-full px-6 py-10 space-y-8">
        <section>
          <h2 className="text-lg font-semibold tracking-tight">Account</h2>
          <p className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <SettingsAccountLine ssrEmail={user?.email} />
          </p>
        </section>

        <SettingsForm
          initialDisplayName={displayName}
          initialLastModel={prefs.lastModel || "deepseek-ai/deepseek-v4-flash"}
          initialThinkingDefault={(prefs.thinkingDefault as "off" | "high" | "max") || "high"}
          initialTheme={(prefs.theme as "light" | "dark" | "system") || "system"}
        />

        <section className="card p-6">
          <h2 className="text-lg font-semibold tracking-tight">Usage</h2>
          <p className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
            All-time stats since you signed up.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-center">
            <div className="rounded-lg border p-4">
              <div className="text-2xl font-semibold">{stats.totalMessages.toLocaleString()}</div>
              <div className="text-xs mt-0.5" style={{ color: "rgb(var(--color-fg-muted))" }}>assistant turns</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-2xl font-semibold">{(stats.totalTokens / 1000).toFixed(1)}K</div>
              <div className="text-xs mt-0.5" style={{ color: "rgb(var(--color-fg-muted))" }}>tokens used</div>
            </div>
          </div>
          <p className="mt-3 text-xs" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            Per-user limits: 10/min · 200/day · 4,000/month chat messages; 30/day FLUX images.
          </p>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold tracking-tight">Trial &amp; terms</h2>
          <p className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
            Polyglot uses NVIDIA NIM&apos;s hosted free trial as its inference backend. Per the
            NIM Trial Terms of Service, this app is for{" "}
            <strong>internal evaluation, development, or test &mdash; non-production use</strong>.
          </p>
          <Link href="/about#nim-terms" className="text-sm underline mt-2 inline-block">
            Read more →
          </Link>
        </section>
      </div>
    </main>
    </SettingsClientGate>
  );
}

