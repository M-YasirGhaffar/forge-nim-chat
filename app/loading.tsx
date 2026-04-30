export default function Loading() {
  return (
    <div className="h-screen grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-current border-t-transparent animate-spin opacity-50" />
        <div className="text-sm" style={{ color: "rgb(var(--color-fg-muted))" }}>Loading…</div>
      </div>
    </div>
  );
}
