import { NextRequest } from "next/server";
import { listAvailableEntries } from "@/lib/models/discovery";
import { batchHealth, getCachedHealth, kickBackgroundRefresh } from "@/lib/models/health";
import { requireUser, GuardError } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
  } catch (e) {
    if (e instanceof GuardError) return e.toResponse();
    throw e;
  }

  const { entries, usingFallback, error } = await listAvailableEntries();
  const url = new URL(req.url);
  const includeHealth = url.searchParams.get("health") === "1";
  const force = url.searchParams.get("force") === "1";

  let health: Record<string, { state: string; latencyMs: number; reason?: string }> = {};
  if (includeHealth) {
    const chatIds = entries.filter((e) => e.endpoint === "chat").map((e) => e.id);

    if (force) {
      // Caller explicitly wants fresh probes. Fall through to the slow path.
      const probed = await batchHealth(chatIds);
      health = Object.fromEntries(
        Object.entries(probed).map(([k, v]) => [k, { state: v.state, latencyMs: v.latencyMs, reason: v.reason }])
      );
    } else {
      // Default: return whatever's cached *immediately* and refresh in the background.
      // The 24-second cold-load was the user-visible bug. Models with no cache entry yet
      // are surfaced as "unknown" so the picker doesn't render a stale "unavailable".
      for (const id of chatIds) {
        const c = getCachedHealth(id);
        health[id] = c
          ? { state: c.state, latencyMs: c.latencyMs, reason: c.reason }
          : { state: "unknown", latencyMs: 0 };
      }
      kickBackgroundRefresh(chatIds);
    }
  }

  return Response.json({ entries, health, usingFallback, error });
}
