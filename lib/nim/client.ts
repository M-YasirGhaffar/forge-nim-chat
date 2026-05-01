import "server-only";

const BASE = process.env.NIM_BASE_URL || "https://integrate.api.nvidia.com/v1";
const KEY = process.env.NVIDIA_API_KEY || "";

if (!KEY) {
  console.warn("[nim] NVIDIA_API_KEY not set — chat will fail");
}

export interface NimChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | NimContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  reasoning_content?: string;
}

export type NimContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

export interface NimChatRequest {
  model: string;
  messages: NimChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  thinking?: { type: "enabled" | "disabled" };
  extra_body?: Record<string, unknown>;
  // Vendor-specific reasoning toggle (DeepSeek family).
  reasoning_effort?: "low" | "medium" | "high" | "max";
  chat_template_kwargs?: Record<string, unknown>;
}

export interface NimUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface NimImageRequest {
  model: string;
  text?: string;
  prompt?: string;
  image?: string; // base64 data URL or raw base64
  steps?: number;
  cfg_scale?: number;
  aspect_ratio?: string;
  seed?: number;
}

export interface NimImageResponse {
  artifacts?: Array<{ base64: string; finishReason?: string; seed?: number }>;
  image?: string;
  data?: Array<{ b64_json?: string; url?: string }>;
}

export class NimError extends Error {
  constructor(public status: number, public body: string, public retryAfter?: number) {
    super(`NIM ${status}: ${body.slice(0, 500)}`);
  }
}

async function nimFetch(path: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: init.headers && (init.headers as Record<string, string>)["Accept"]
        ? (init.headers as Record<string, string>)["Accept"]
        : "application/json",
      ...(init.headers || {}),
    },
  });

  if (res.status === 429 && attempt < 1) {
    const retryAfter = Number(res.headers.get("retry-after") || "1");
    await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 5000)));
    return nimFetch(path, init, attempt + 1);
  }

  return res;
}

export async function nimChatCompletionsStream(
  req: NimChatRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const body = JSON.stringify({
    ...req,
    stream: true,
    stream_options: { include_usage: true, ...(req.stream_options || {}) },
  });
  const res = await nimFetch("/chat/completions", {
    method: "POST",
    body,
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new NimError(res.status, text);
  }
  return res;
}

export async function nimChatCompletions(req: NimChatRequest): Promise<{
  content: string;
  reasoning: string;
  usage: NimUsage | null;
  finishReason: string | null;
}> {
  const res = await nimFetch("/chat/completions", {
    method: "POST",
    body: JSON.stringify({ ...req, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NimError(res.status, text);
  }
  const json = (await res.json()) as {
    choices: Array<{
      message: { content: string | null; reasoning_content?: string };
      finish_reason: string | null;
    }>;
    usage: NimUsage;
  };
  const c = json.choices?.[0];
  return {
    content: c?.message?.content ?? "",
    reasoning: c?.message?.reasoning_content ?? "",
    usage: json.usage ?? null,
    finishReason: c?.finish_reason ?? null,
  };
}

/**
 * Returned image format. NIM hosted FLUX endpoints reply with JPEG bytes wrapped in
 * `{ artifacts: [{ base64, finishReason, seed }] }`. We default the mime to JPEG
 * because the magic bytes confirm the upstream is JPEG, not PNG (despite the
 * `image/png` content type the model card sometimes mentions).
 */
export async function nimImageGenerate(req: NimImageRequest): Promise<{
  base64: string;
  mimeType: "image/jpeg" | "image/png";
  seed?: number;
}> {
  const aiBase = process.env.NIM_IMAGE_BASE_URL || "https://ai.api.nvidia.com/v1";
  const isSchnell = req.model.includes("schnell");
  const isDev = req.model.includes("flux.1-dev") || /\bdev\b/.test(req.model) && !req.model.includes("kontext");
  const isKontext = req.model.includes("kontext");

  // Width/height per the published per-model enums.
  const { width, height } = aspectToWH(req.aspect_ratio, isKontext);

  const prompt = (req.prompt ?? req.text ?? "").slice(0, 10_000);
  const body: Record<string, unknown> = { prompt, width, height };
  if (req.seed != null) body.seed = Math.max(0, Math.trunc(req.seed));

  if (isSchnell) {
    // schnell: distilled; 1–4 steps; cfg_scale must be 0 (omit → default 0).
    if (req.steps != null) body.steps = clamp(req.steps, 1, 4);
  } else if (isKontext) {
    // Kontext on the hosted preview *only* accepts pre-canned reference images
    // referenced via `data:image/png;example_id,N` where N ∈ {0,1,2}. User-uploaded
    // base64 reference images are NOT supported on the preview endpoint. To keep the
    // route usable we accept whichever the caller passed; if it's a normal data URL
    // NIM will reject with 4xx and we surface that error to the UI.
    if (req.image) body.image = req.image;
    if (req.steps != null) body.steps = clamp(req.steps, 20, 50);
    if (req.cfg_scale != null) body.cfg_scale = clamp(req.cfg_scale, 0, 9);
  } else {
    // dev (and any non-distilled FLUX variant): 5–100 steps, cfg ≤ 9.
    if (req.steps != null) body.steps = clamp(req.steps, 5, 100);
    if (req.cfg_scale != null) body.cfg_scale = clamp(req.cfg_scale, 0, 9);
  }
  void isDev;

  const url = `${aiBase}/genai/${req.model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new NimError(res.status, `${url} → ${text}`);
  }
  const json = (await res.json()) as NimImageResponse;
  const b64 =
    json.artifacts?.[0]?.base64 ||
    json.image ||
    json.data?.[0]?.b64_json ||
    "";
  if (!b64) {
    throw new NimError(502, `No image in NIM response: ${JSON.stringify(json).slice(0, 240)}`);
  }
  // Sniff the mime from base64 magic bytes. JPEG starts with `/9j/`; PNG with `iVBOR`.
  const mimeType: "image/jpeg" | "image/png" = b64.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return { base64: b64, mimeType, seed: json.artifacts?.[0]?.seed };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function aspectToWH(aspect?: string, isKontext = false): { width: number; height: number } {
  // Kontext uses a different enum (672–1568 in 16-step increments). For simplicity we
  // ignore aspect_ratio for Kontext and let NIM's `match_input_image` default kick in
  // by sending a square. This matches what the docs show in their sample.
  if (isKontext) return { width: 1024, height: 1024 };
  switch (aspect) {
    case "16:9": return { width: 1344, height: 768 };
    case "9:16": return { width: 768, height: 1344 };
    case "3:2":  return { width: 1216, height: 832 };
    case "2:3":  return { width: 832, height: 1216 };
    case "4:3":  return { width: 1152, height: 896 };
    case "3:4":  return { width: 896, height: 1152 };
    case "1:1":
    default:     return { width: 1024, height: 1024 };
  }
}

export async function nimListModels(): Promise<Array<{ id: string }> | null> {
  try {
    const res = await nimFetch("/models", { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return json.data ?? null;
  } catch {
    return null;
  }
}
