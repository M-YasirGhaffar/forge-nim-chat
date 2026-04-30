import Link from "next/link";
import { MODEL_REGISTRY } from "@/lib/models/registry";

export const metadata = { title: "About — Polyglot" };

export default function AboutPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-semibold">Polyglot</Link>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="btn btn-secondary">Sign in</Link>
          </nav>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-16 prose-chat">
        <h1>About Polyglot</h1>
        <p>
          Polyglot is a multi-model AI chat product. The goal is simple: every frontier open
          model worth using, behind one clean chat interface, with the same streaming UX
          you&apos;d expect from Claude.ai or ChatGPT — including thinking traces, image and
          PDF understanding, and a live artifacts panel.
        </p>

        <h2>The model picker</h2>
        <p>The chat exposes these models, each with its own strengths:</p>
        <ul>
          {MODEL_REGISTRY.map((m) => (
            <li key={m.id}>
              <strong>{m.displayName}</strong> — {m.tagline}
              {m.contextWindow > 0 && <> ({(m.contextWindow / 1000).toFixed(0)}K context)</>}
              . License: {m.license}.
            </li>
          ))}
        </ul>

        <h2>How it works</h2>
        <p>
          All inference goes through the NVIDIA NIM hosted trial endpoint
          (<code>integrate.api.nvidia.com/v1</code>), which exposes every model in this catalog
          via a single OpenAI-compatible API. Your <code>nvapi-</code> key never reaches the
          browser — it lives on the server, behind Firebase ID-token + App Check verification.
        </p>
        <p>
          Streaming uses SSE end-to-end. We parse the upstream stream, separate reasoning
          tokens from chat content, intercept artifact directives, and re-emit a typed
          newline-delimited JSON stream the chat UI consumes. Artifacts render in a
          sandboxed iframe (<code>sandbox=&quot;allow-scripts&quot;</code>) so model output
          can&apos;t escape into the host page.
        </p>

        <h2 id="nim-terms">NIM trial &amp; terms of use</h2>
        <p>
          NIM&apos;s hosted endpoints are governed by the NVIDIA API Trial Terms of Service:
          <em> internal evaluation, development, or test &mdash; non-production use.</em>
          Polyglot is a portfolio demo; if you&apos;re evaluating it for production, the
          architecture is designed to swap the inference adapter to a paid provider with
          one config change. The shared rate limit on the NIM trial is{" "}
          <strong>40 requests per minute per model</strong>, and the app layers its own
          per-user limits on top to prevent any single user from monopolizing the bucket.
        </p>

        <h2>Privacy &amp; security</h2>
        <ul>
          <li>Authentication via Firebase (email link or Google OAuth).</li>
          <li>Chats and messages stored in Firestore under your user ID.</li>
          <li>Attachments stored in Firebase Storage at <code>users/&lt;uid&gt;/...</code> with signed URLs (one-hour TTL).</li>
          <li>App Check + reCAPTCHA Enterprise on every API route to deter scripted abuse.</li>
          <li>
            We log usage counts (messages, tokens, FLUX calls) per user per day for rate
            limiting. We do <em>not</em> sell or share chat content.
          </li>
        </ul>

        <h2>Honest caveats</h2>
        <ul>
          <li>FLUX.1 Dev and FLUX.1 Kontext are non-commercial — generated images are flagged accordingly.</li>
          <li>Reasoning models can be slow. Think Max on DeepSeek V4 Pro routinely runs 30–90 seconds for a single answer.</li>
          <li>Model availability on NIM may change without notice. We surface that immediately and fall back to a sibling model when possible.</li>
        </ul>

        <p>
          <Link href="/chat">Try it →</Link>
        </p>
      </article>
    </main>
  );
}
