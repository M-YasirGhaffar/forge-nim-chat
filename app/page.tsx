import Link from "next/link";
import { ArrowRight, Sparkles, Zap, Box, Eye } from "lucide-react";
import { listAvailableEntries } from "@/lib/models/discovery";
import { getSessionUser } from "@/lib/firebase/session";
import type { ModelEntry } from "@/lib/types";
import { BrandLogo, BrandName, BRAND_TAGLINE } from "@/components/brand";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
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
            <BrandLogo size={26} />
            <BrandName />
          </Link>
          <nav className="flex items-center gap-2">
            {signedIn ? (
              <Link href="/chat" className="btn btn-primary">
                Open chat <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[700px] w-[1100px] rounded-full bg-[radial-gradient(closest-side,rgba(70,95,255,0.18),transparent)]" />
        </div>
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="flex items-center gap-2 mb-6 text-xs font-medium" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <span className="pill">
              <Sparkles className="h-3 w-3" /> {llmCount} chat models · {imgCount} image models
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-semibold tracking-tight max-w-4xl leading-[1.05]">
            <span className="bg-gradient-to-r from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.55)] bg-clip-text text-transparent">
              {BRAND_TAGLINE}
            </span>
          </h1>
          <p className="mt-6 text-lg max-w-2xl" style={{ color: "rgb(var(--color-fg-muted))" }}>
            Frontier reasoning, multimodal vision, and image generation in a single chat.
            Live model availability, streaming responses, no clutter.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/chat" : "/login"}
              className="btn btn-primary h-11 px-5 text-[0.95rem]"
            >
              {signedIn ? "Open chat" : "Get started"} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Live model catalog
          </h2>
          <p className="mt-2 max-w-2xl" style={{ color: "rgb(var(--color-fg-muted))" }}>
            Pulled directly from NVIDIA NIM at request time. Each model has different
            strengths — pick the right one for the task.
          </p>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {entries.map((m) => (
              <div key={m.id} className="card p-5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{m.displayName}</div>
                  <span className="pill shrink-0">{m.paramHint}</span>
                </div>
                <div className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>
                  {m.tagline}
                </div>
                <div className="flex items-center gap-2 mt-auto pt-2 flex-wrap text-[11px]" style={{ color: "rgb(var(--color-fg-subtle))" }}>
                  <span>{m.vendor}</span>
                  {m.contextWindow > 0 && (
                    <>
                      <span>·</span>
                      <span>{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                    </>
                  )}
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
            title="Streaming responses"
            body="Every token as soon as the model produces it. No spinner-and-wait."
          />
          <Feature
            icon={<Box className="h-5 w-5" />}
            title="Live artifacts"
            body="HTML, React, SVG, Mermaid, code — rendered next to the chat in a sandboxed view."
          />
          <Feature
            icon={<Eye className="h-5 w-5" />}
            title="Multimodal input"
            body="Drag in images or PDFs. Multimodal models read them natively."
          />
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: "rgb(var(--color-fg-muted))" }}>
          <div>Powered by NVIDIA NIM.</div>
          <div className="flex items-center gap-2">
            <BrandLogo size={16} />
            <BrandName />
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
