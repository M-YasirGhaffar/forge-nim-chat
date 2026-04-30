import Link from "next/link";
import { ArrowRight, Sparkles, Zap, Box, Eye, Shield, Github } from "lucide-react";
import { listAvailableEntries } from "@/lib/models/discovery";
import { getSessionUser } from "@/lib/firebase/session";
import type { ModelEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // Fetch live models from NIM (cached); fall back to allowlist if unreachable.
  // Show every entry — even non-commercial-licensed ones (FLUX.1 Dev, Kontext) are free
  // on the NIM trial. The license is surfaced inline on each card.
  const [user, modelData] = await Promise.all([
    getSessionUser().catch(() => null),
    listAvailableEntries().catch(() => ({ entries: [] as ModelEntry[], usingFallback: true })),
  ]);
  return <LandingShell entries={modelData.entries} signedIn={!!user} />;
}

function LandingShell({ entries, signedIn }: { entries: ModelEntry[]; signedIn: boolean }) {
  const llmCount = entries.filter((m) => m.category !== "image").length;
  const imgCount = entries.filter((m) => m.category === "image").length;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Logo className="h-7 w-7" />
            <span>Polyglot</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/about" className="btn btn-ghost">About</Link>
            {signedIn ? (
              <Link href="/chat" className="btn btn-primary">Open chat <ArrowRight className="h-4 w-4" /></Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-secondary">Sign in</Link>
                <Link href="/login" className="btn btn-primary">Try free</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[700px] w-[1100px] rounded-full bg-[radial-gradient(closest-side,rgba(70,95,255,0.18),transparent)]" />
          <div className="absolute -bottom-32 right-1/4 h-[500px] w-[800px] rounded-full bg-[radial-gradient(closest-side,rgba(160,77,255,0.18),transparent)]" />
        </div>
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="flex items-center gap-2 mb-6 text-xs font-medium" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <span className="pill"><Sparkles className="h-3 w-3" /> {llmCount} reasoning models · {imgCount} image models</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-semibold tracking-tight max-w-4xl leading-[1.05]">
            Frontier AI,<br />
            <span className="bg-gradient-to-r from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.55)] bg-clip-text text-transparent">
              many models, one chat.
            </span>
          </h1>
          <p className="mt-6 text-lg max-w-2xl" style={{ color: "rgb(var(--color-fg-muted))" }}>
            Frontier reasoning, multimodal vision, and image generation in a single chat. Streaming
            reasoning traces, live artifacts, and per-model controls — all on the NVIDIA NIM trial.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href={signedIn ? "/chat" : "/login"} className="btn btn-primary h-11 px-5 text-[0.95rem]">
              {signedIn ? "Open chat" : "Start chatting"} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/about" className="btn btn-secondary h-11 px-5 text-[0.95rem]">How it works</Link>
          </div>
          <p className="mt-6 text-xs" style={{ color: "rgb(var(--color-fg-subtle))" }}>
            Free trial via NVIDIA NIM. No credit card. ToS:{" "}
            <Link href="/about#nim-terms" className="underline">non-production use</Link>.
          </p>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            One picker. Every frontier model.
          </h2>
          <p className="mt-2 max-w-2xl" style={{ color: "rgb(var(--color-fg-muted))" }}>
            Each model has different strengths — pick the right one without juggling tabs and API keys.
          </p>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {entries.map((m) => (
              <div key={m.id} className="card p-5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{m.displayName}</div>
                  <span className="pill">{m.paramHint}</span>
                </div>
                <div className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>{m.tagline}</div>
                <div className="flex items-center gap-2 mt-auto pt-2 flex-wrap text-[11px]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
                  <span>{m.vendor}</span>
                  <span>·</span>
                  {m.contextWindow > 0 && <><span>{(m.contextWindow / 1000).toFixed(0)}K ctx</span><span>·</span></>}
                  <span>{m.license}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-[rgb(var(--color-bg-soft))]">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20 grid md:grid-cols-3 gap-6">
          <Feature
            icon={<Zap className="h-5 w-5" />}
            title="Streaming reasoning traces"
            body="See the model think before it answers. Collapse or expand the trace per turn."
          />
          <Feature
            icon={<Box className="h-5 w-5" />}
            title="Live artifacts panel"
            body="HTML, React, SVG, Mermaid, code — rendered in a sandboxed iframe right next to the chat."
          />
          <Feature
            icon={<Eye className="h-5 w-5" />}
            title="Multimodal input"
            body="Drag in images, PDFs, or video. Multimodal models see them natively."
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: "rgb(var(--color-fg-muted))" }}>
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" />
            <span>Powered by NVIDIA NIM hosted trial · non-production use only</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/about" className="hover:underline">About</Link>
            <Link href="/about#nim-terms" className="hover:underline">Terms</Link>
            <a href="https://github.com" className="hover:underline inline-flex items-center gap-1">
              <Github className="h-3.5 w-3.5" /> Source
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div>
      <div className="h-9 w-9 rounded-lg bg-[rgb(var(--color-bg-elev))] border flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>{body}</p>
    </div>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#465fff" />
          <stop offset="1" stopColor="#a04dff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#lg)" />
      <path d="M9 22V10h4l3 7 3-7h4v12h-3v-7l-2.6 6h-2.8L12 15v7z" fill="#fff" />
    </svg>
  );
}
