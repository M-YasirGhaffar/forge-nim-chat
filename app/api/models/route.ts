import { NextRequest } from "next/server";
import { listAvailableEntries } from "@/lib/models/discovery";
import { batchHealth, getCachedHealth } from "@/lib/models/health";
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
  const url = new URL(req.url);
  const includeHealth = url.searchParams.get("health") === "1";
  const force = url.searchParams.get("force") === "1";

  let health: Record<string, { state: string; latencyMs: number; reason?: string }> = {};
  if (includeHealth) {
    const ids = entries.filter((e) => e.endpoint === "chat").map((e) => e.id);

    // Task 17: avoid running fresh probes on every mount. Default behavior is to read
    // whatever's already in the in-memory health cache (no NIM round-trip). Only fire
    // fresh `batchHealth` probes when the caller explicitly opts in via `force=1`,
    // OR when the cache is largely cold (>50% of chat models have no entry yet).
    const cached: Record<string, { state: string; latencyMs: number; reason?: string }> = {};
    let coldCount = 0;
    for (const id of ids) {
      const c = getCachedHealth(id);
      if (c) {
        cached[id] = { state: c.state, latencyMs: c.latencyMs, reason: c.reason };
      } else {
        coldCount++;
      }
    }
    const cacheCold = ids.length > 0 && coldCount / ids.length > 0.5;

    if (force || cacheCold) {
      const probed = await batchHealth(ids);
      health = Object.fromEntries(
        Object.entries(probed).map(([k, v]) => [
          k,
          { state: v.state, latencyMs: v.latencyMs, reason: v.reason },
        ])
      );
    } else {
      health = cached;
    }
  }

  return Response.json({
    entries,
    health,
    usingFallback,
    error,
  });
}
