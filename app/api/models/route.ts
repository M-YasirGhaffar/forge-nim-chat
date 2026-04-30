import { NextRequest } from "next/server";
import { listAvailableEntries } from "@/lib/models/discovery";
import { batchHealth } from "@/lib/models/health";
import { requireUser, GuardError } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Auth required so we don't expose the model catalog to bots.
  try {
    await requireUser(req);
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }

  const { entries, usingFallback, error } = await listAvailableEntries();
  // Fire-and-forget health probes so the next request has fresh data.
  // We don't block here — a `health` field will be populated incrementally.
  const url = new URL(req.url);
  const includeHealth = url.searchParams.get("health") === "1";

  let health: Record<string, { state: string; latencyMs: number; reason?: string }> = {};
  if (includeHealth) {
    const ids = entries.filter((e) => e.endpoint === "chat").map((e) => e.id);
    const probed = await batchHealth(ids);
    health = Object.fromEntries(
      Object.entries(probed).map(([k, v]) => [
        k,
        { state: v.state, latencyMs: v.latencyMs, reason: v.reason },
      ])
    );
  }

  return Response.json({
    entries,
    health,
    usingFallback,
    error,
  });
}
