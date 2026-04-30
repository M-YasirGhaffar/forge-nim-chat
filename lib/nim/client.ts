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

export async function nimChatCompletionsStream(req: NimChatRequest): Promise<Response> {
  const body = JSON.stringify({
    ...req,
    stream: true,
    stream_options: { include_usage: true, ...(req.stream_options || {}) },
  });
  const res = await nimFetch("/chat/completions", {
    method: "POST",
    body,
    headers: { Accept: "text/event-stream" },
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

export async function nimImageGenerate(req: NimImageRequest): Promise<{
  base64: string;
  seed?: number;
}> {
  // FLUX endpoints on NIM accept the OpenAI-style body but live at /infer or /images/generations
  // depending on the model. Try /chat/completions first for FLUX (NIM has been migrating), then
  // fall back to model-specific paths.
  const candidates = [
    `/genai/${encodeURIComponent(req.model)}/infer`,
    `/${encodeURIComponent(req.model)}/infer`,
    "/images/generations",
  ];

  let lastErr: NimError | null = null;
  for (const path of candidates) {
    const body =
      path === "/images/generations"
        ? JSON.stringify({
            model: req.model,
            prompt: req.prompt ?? req.text,
            n: 1,
            size: openAiSize(req.aspect_ratio),
            response_format: "b64_json",
          })
        : JSON.stringify({
            text: req.prompt ?? req.text,
            prompt: req.prompt ?? req.text,
            ...(req.image ? { image: req.image } : {}),
            ...(req.steps != null ? { steps: req.steps } : {}),
            ...(req.cfg_scale != null ? { cfg_scale: req.cfg_scale } : {}),
            ...(req.aspect_ratio ? { aspect_ratio: req.aspect_ratio } : {}),
            ...(req.seed != null ? { seed: req.seed } : {}),
          });
    const res = await nimFetch(path, { method: "POST", body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      lastErr = new NimError(res.status, text);
      // 404 → try next candidate; other errors → bail.
      if (res.status === 404) continue;
      throw lastErr;
    }
    const json = (await res.json()) as NimImageResponse;
    const b64 =
      json.artifacts?.[0]?.base64 ||
      json.image ||
      json.data?.[0]?.b64_json ||
      "";
    if (!b64) {
      lastErr = new NimError(500, `No image in response from ${path}`);
      continue;
    }
    return { base64: b64, seed: json.artifacts?.[0]?.seed };
  }
  throw lastErr ?? new NimError(500, "No FLUX endpoint succeeded");
}

function openAiSize(aspect?: string): string {
  switch (aspect) {
    case "16:9":
      return "1344x768";
    case "9:16":
      return "768x1344";
    case "3:2":
      return "1216x832";
    case "2:3":
      return "832x1216";
    case "4:3":
      return "1152x896";
    case "3:4":
      return "896x1152";
    default:
      return "1024x1024";
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
