import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const enabled = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = enabled
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

const stub = {
  limit: async () => ({ success: true, limit: 0, remaining: 0, reset: 0, pending: Promise.resolve() }),
};

function build(prefix: string, limit: number, window: Parameters<typeof Ratelimit.slidingWindow>[1]) {
  if (!redis) return stub as unknown as Ratelimit;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    analytics: true,
    prefix,
  });
}

export const chatPerMinute = build("rl:chat:m", 10, "60 s");
export const chatPerDay = build("rl:chat:d", 200, "1 d");
export const chatPerMonth = build("rl:chat:mo", 4000, "30 d");
export const fluxPerDay = build("rl:flux:d", 30, "1 d");
export const ipPerMinute = build("rl:ip:m", 3, "60 s");

export async function checkChatLimits(uid: string) {
  const [m, d, mo] = await Promise.all([
    chatPerMinute.limit(`u:${uid}`),
    chatPerDay.limit(`u:${uid}`),
    chatPerMonth.limit(`u:${uid}`),
  ]);
  if (!m.success) return { ok: false as const, scope: "minute" as const, retryAfter: Math.ceil((m.reset - Date.now()) / 1000) };
  if (!d.success) return { ok: false as const, scope: "day" as const, retryAfter: Math.ceil((d.reset - Date.now()) / 1000) };
  if (!mo.success) return { ok: false as const, scope: "month" as const, retryAfter: Math.ceil((mo.reset - Date.now()) / 1000) };
  return { ok: true as const, remaining: { minute: m.remaining, day: d.remaining, month: mo.remaining } };
}

export async function checkFluxLimit(uid: string) {
  const r = await fluxPerDay.limit(`u:${uid}`);
  if (!r.success) return { ok: false as const, retryAfter: Math.ceil((r.reset - Date.now()) / 1000) };
  return { ok: true as const, remaining: r.remaining };
}
