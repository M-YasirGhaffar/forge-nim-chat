import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center">
      <div className="text-center">
        <div className="text-5xl font-semibold tracking-tight mb-2">404</div>
        <p style={{ color: "rgb(var(--color-fg-muted))" }}>This chat doesn&apos;t exist or you don&apos;t have access.</p>
        <Link href="/chat" className="btn btn-primary mt-5">Start a new chat</Link>
      </div>
    </main>
  );
}
