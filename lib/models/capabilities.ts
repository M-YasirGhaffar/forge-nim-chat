/**
 * Static capability matcher: given a model id, infer everything we know about it without
 * needing to maintain a hardcoded full list. Pattern-matches by vendor + family + qualifier.
 *
 * The actual list of available models comes from NIM /v1/models at runtime
 * (lib/models/discovery.ts) so deprecated/added models don't require code edits.
 */

import type { ModelEntry, ModelCategory, ModelKind, ThinkingMode } from "@/lib/types";

interface Capability {
  vendor: string;
  displayName: string;
  category: ModelCategory;
  kind: ModelKind;
  contextWindow: number;
  maxOutput: number;
  supportsImages: boolean;
  supportsVideo: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  thinkingModes: ThinkingMode[];
  defaultThinking?: ThinkingMode;
  paramHint: string;
  paramCountB: number;
  activatedB?: number;
  license: string;
  licenseCommercial: boolean;
  tagline: string;
  endpoint: "chat" | "infer";
  recommendedTemperature?: number;
  recommendedTopP?: number;
  recommendedTopK?: number;
  notes?: string;
}

/**
 * Allowlist of model IDs we want to surface. Prefer "big" flagship models per the SRS.
 * If a model id appears in NIM's /v1/models AND in this allowlist, it's shown.
 * Adding a new model = one line here; deprecation = it just stops appearing in NIM's list.
 */
export const ALLOWED_MODELS: Record<string, Capability> = {
  // ───── DeepSeek ─────
  "deepseek-ai/deepseek-v4-pro": {
    vendor: "DeepSeek",
    displayName: "DeepSeek V4 Pro",
    category: "reasoning",
    kind: "llm",
    contextWindow: 1_000_000,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high", "max"],
    defaultThinking: "high",
    paramHint: "1.6T MoE · 49B active",
    paramCountB: 1600,
    activatedB: 49,
    license: "MIT",
    licenseCommercial: true,
    tagline: "Maximum reasoning, slowest. Best for hard problems.",
    endpoint: "chat",
    recommendedTemperature: 1.0,
  },
  "deepseek-ai/deepseek-v4-flash": {
    vendor: "DeepSeek",
    displayName: "DeepSeek V4 Flash",
    category: "reasoning",
    kind: "llm",
    contextWindow: 1_000_000,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high", "max"],
    defaultThinking: "high",
    paramHint: "284B MoE · 13B active",
    paramCountB: 284,
    activatedB: 13,
    license: "MIT",
    licenseCommercial: true,
    tagline: "Fast reasoning. Good default for general queries.",
    endpoint: "chat",
    recommendedTemperature: 1.0,
  },
  "deepseek-ai/deepseek-v3.2": {
    vendor: "DeepSeek",
    displayName: "DeepSeek V3.2",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "off",
    paramHint: "671B MoE",
    paramCountB: 671,
    activatedB: 37,
    license: "MIT",
    licenseCommercial: true,
    tagline: "Stable predecessor — reliable fallback.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "deepseek-ai/deepseek-v3.1-terminus": {
    vendor: "DeepSeek",
    displayName: "DeepSeek V3.1 Terminus",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "off",
    paramHint: "Refined V3 series",
    paramCountB: 671,
    activatedB: 37,
    license: "MIT",
    licenseCommercial: true,
    tagline: "Fast, capable predecessor.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── Moonshot AI ─────
  "moonshotai/kimi-k2-thinking": {
    vendor: "Moonshot AI",
    displayName: "Kimi K2 Thinking",
    category: "reasoning",
    kind: "llm",
    contextWindow: 256_000,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["high"],
    defaultThinking: "high",
    paramHint: "1T MoE · 32B active · INT4",
    paramCountB: 1000,
    activatedB: 32,
    license: "Modified MIT",
    licenseCommercial: true,
    tagline: "Best for long agentic tasks (research, multi-step coding).",
    endpoint: "chat",
    recommendedTemperature: 1.0,
  },
  "moonshotai/kimi-k2-instruct-0905": {
    vendor: "Moonshot AI",
    displayName: "Kimi K2 Instruct",
    category: "reasoning",
    kind: "llm",
    contextWindow: 200_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "1T MoE · 32B active",
    paramCountB: 1000,
    activatedB: 32,
    license: "Modified MIT",
    licenseCommercial: true,
    tagline: "Snappy frontier general-purpose model.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "moonshotai/kimi-k2-instruct": {
    vendor: "Moonshot AI",
    displayName: "Kimi K2 Instruct (legacy)",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "1T MoE",
    paramCountB: 1000,
    activatedB: 32,
    license: "Modified MIT",
    licenseCommercial: true,
    tagline: "Earlier K2 release.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── Z.ai (formerly Zhipu) ─────
  "z-ai/glm-5.1": {
    vendor: "Z.ai",
    displayName: "GLM 5.1",
    category: "reasoning",
    kind: "llm",
    contextWindow: 200_000,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "high",
    paramHint: "754B MoE · 40B active",
    paramCountB: 754,
    activatedB: 40,
    license: "NVIDIA Open Model",
    licenseCommercial: true,
    tagline: "Open-source coding & agentic engineering flagship.",
    endpoint: "chat",
    recommendedTemperature: 0.6,
  },
  "z-ai/glm5": {
    vendor: "Z.ai",
    displayName: "GLM 5",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "off",
    paramHint: "MoE",
    paramCountB: 250,
    license: "NVIDIA Open Model",
    licenseCommercial: true,
    tagline: "GLM 5 series — capable open model.",
    endpoint: "chat",
    recommendedTemperature: 0.6,
  },
  "z-ai/glm4.7": {
    vendor: "Z.ai",
    displayName: "GLM 4.7",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "Stable GLM 4 series",
    paramCountB: 130,
    license: "NVIDIA Open Model",
    licenseCommercial: true,
    tagline: "Reliable, fast GLM 4 family.",
    endpoint: "chat",
    recommendedTemperature: 0.6,
  },

  // ───── Alibaba (Qwen) ─────
  "qwen/qwen3.5-397b-a17b": {
    vendor: "Alibaba",
    displayName: "Qwen 3.5 397B",
    category: "multimodal",
    kind: "vlm",
    contextWindow: 262_144,
    maxOutput: 32_000,
    supportsImages: true,
    supportsVideo: true,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "high",
    paramHint: "397B MoE · 17B active · VLM",
    paramCountB: 397,
    activatedB: 17,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Largest multimodal — best for image/video reasoning.",
    notes: "Up to 1344x1344 images. Supports video URLs.",
    endpoint: "chat",
    recommendedTemperature: 0.6,
    recommendedTopP: 0.95,
    recommendedTopK: 20,
  },
  "qwen/qwen3.5-122b-a10b": {
    vendor: "Alibaba",
    displayName: "Qwen 3.5 122B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 131_072,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["off", "high"],
    defaultThinking: "high",
    paramHint: "122B MoE · 10B active",
    paramCountB: 122,
    activatedB: 10,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Smaller Qwen 3.5 — fast and capable.",
    endpoint: "chat",
    recommendedTemperature: 0.6,
  },
  "qwen/qwen3-coder-480b-a35b-instruct": {
    vendor: "Alibaba",
    displayName: "Qwen3 Coder 480B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 262_144,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "480B MoE · 35B active · coder",
    paramCountB: 480,
    activatedB: 35,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Best-in-class open code generation.",
    endpoint: "chat",
    recommendedTemperature: 0.5,
  },
  "qwen/qwen3-next-80b-a3b-thinking": {
    vendor: "Alibaba",
    displayName: "Qwen3 Next 80B Thinking",
    category: "reasoning",
    kind: "llm",
    contextWindow: 262_144,
    maxOutput: 32_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: true,
    thinkingModes: ["high"],
    defaultThinking: "high",
    paramHint: "80B MoE · 3B active · thinking",
    paramCountB: 80,
    activatedB: 3,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Compact thinking model with long context.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "qwen/qwen3-next-80b-a3b-instruct": {
    vendor: "Alibaba",
    displayName: "Qwen3 Next 80B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 262_144,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "80B MoE · 3B active",
    paramCountB: 80,
    activatedB: 3,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Compact frontier general model.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── Meta ─────
  "meta/llama-3.3-70b-instruct": {
    vendor: "Meta",
    displayName: "Llama 3.3 70B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "70B dense",
    paramCountB: 70,
    license: "Llama 3.3 Community",
    licenseCommercial: true,
    tagline: "Reliable Meta flagship 70B.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "meta/llama-3.1-405b-instruct": {
    vendor: "Meta",
    displayName: "Llama 3.1 405B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "405B dense",
    paramCountB: 405,
    license: "Llama 3.1 Community",
    licenseCommercial: true,
    tagline: "Largest Meta dense model.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "meta/llama-4-maverick-17b-128e-instruct": {
    vendor: "Meta",
    displayName: "Llama 4 Maverick",
    category: "reasoning",
    kind: "llm",
    contextWindow: 1_000_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "17B × 128 experts",
    paramCountB: 400,
    activatedB: 17,
    license: "Llama 4 Community",
    licenseCommercial: true,
    tagline: "Llama 4 MoE — long context.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── Mistral ─────
  "mistralai/mistral-large-3-675b-instruct-2512": {
    vendor: "Mistral",
    displayName: "Mistral Large 3 675B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 200_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "675B MoE",
    paramCountB: 675,
    license: "Mistral Research / Commercial",
    licenseCommercial: true,
    tagline: "Mistral's largest flagship.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },
  "mistralai/devstral-2-123b-instruct-2512": {
    vendor: "Mistral",
    displayName: "Devstral 2 123B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 256_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "123B coder",
    paramCountB: 123,
    license: "Mistral Research / Commercial",
    licenseCommercial: true,
    tagline: "Mistral's flagship coding model.",
    endpoint: "chat",
    recommendedTemperature: 0.5,
  },

  // ───── OpenAI (open weights) ─────
  "openai/gpt-oss-120b": {
    vendor: "OpenAI",
    displayName: "GPT-OSS 120B",
    category: "reasoning",
    kind: "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "120B open weights",
    paramCountB: 120,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "OpenAI's open-weight 120B.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── MiniMax ─────
  "minimaxai/minimax-m2.7": {
    vendor: "MiniMax",
    displayName: "MiniMax M2.7",
    category: "reasoning",
    kind: "llm",
    contextWindow: 200_000,
    maxOutput: 16_000,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "MoE",
    paramCountB: 200,
    license: "Custom",
    licenseCommercial: true,
    tagline: "MiniMax frontier MoE.",
    endpoint: "chat",
    recommendedTemperature: 0.7,
  },

  // ───── FLUX (image generation) ─────
  // These live on a different NIM endpoint (/genai/{model}/infer) and don't show up in
  // /v1/models — we surface them unconditionally and trust the live ping to flag broken ones.
  "black-forest-labs/flux.1-schnell": {
    vendor: "Black Forest Labs",
    displayName: "FLUX.1 Schnell",
    category: "image",
    kind: "image",
    contextWindow: 0,
    maxOutput: 0,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: false,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "1–4 step distilled",
    paramCountB: 12,
    license: "Apache 2.0",
    licenseCommercial: true,
    tagline: "Fast text-to-image. Commercial-friendly.",
    endpoint: "infer",
  },
  "black-forest-labs/flux.1-dev": {
    vendor: "Black Forest Labs",
    displayName: "FLUX.1 Dev",
    category: "image",
    kind: "image",
    contextWindow: 0,
    maxOutput: 0,
    supportsImages: false,
    supportsVideo: false,
    supportsTools: false,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "Highest quality",
    paramCountB: 12,
    license: "Non-commercial",
    licenseCommercial: false,
    tagline: "Highest-quality text-to-image (non-commercial).",
    endpoint: "infer",
  },
  "black-forest-labs/flux.1-kontext-dev": {
    vendor: "Black Forest Labs",
    displayName: "FLUX.1 Kontext",
    category: "image",
    kind: "image",
    contextWindow: 0,
    maxOutput: 0,
    supportsImages: true,
    supportsVideo: false,
    supportsTools: false,
    supportsThinking: false,
    thinkingModes: [],
    paramHint: "Image editing",
    paramCountB: 12,
    license: "Non-commercial",
    licenseCommercial: false,
    tagline: "Edit existing images — text + reference image → image.",
    endpoint: "infer",
  },
};

/**
 * Build a ModelEntry from an id. Falls back to inferred defaults when the id
 * isn't in our hint table — this lets newly-launched NIM models flow through
 * without code edits.
 */
export function buildEntry(id: string): ModelEntry | null {
  const c = ALLOWED_MODELS[id] ?? inferCapability(id);
  if (!c) return null;
  return { id, ...c };
}

export function isAllowedModel(id: string): boolean {
  return id in ALLOWED_MODELS;
}

export function allAllowedIds(): string[] {
  return Object.keys(ALLOWED_MODELS);
}

export function imageModelIds(): string[] {
  return Object.keys(ALLOWED_MODELS).filter((id) => ALLOWED_MODELS[id].endpoint === "infer");
}

/**
 * Best-effort capability inference for ids we haven't hand-curated. Pattern-matches
 * vendor/family from the id segments and falls back to safe defaults — the model
 * works (NIM enforces its own limits), the UI just won't have a custom tagline.
 */
function inferCapability(id: string): Capability | null {
  if (!id || !id.includes("/")) return null;
  const [vendor, name] = id.split("/", 2);
  const lower = id.toLowerCase();
  const vendorLabel = humanizeVendor(vendor);
  const display = humanizeName(name);

  // FLUX / image generation
  if (lower.includes("flux") || lower.includes("schnell") || lower.includes("kontext")) {
    return {
      vendor: vendorLabel,
      displayName: display,
      category: "image",
      kind: "image",
      contextWindow: 0,
      maxOutput: 0,
      supportsImages: lower.includes("kontext"),
      supportsVideo: false,
      supportsTools: false,
      supportsThinking: false,
      thinkingModes: [],
      paramHint: "image generation",
      paramCountB: 12,
      license: "Apache 2.0",
      licenseCommercial: !lower.includes("dev") && !lower.includes("kontext"),
      tagline: "Image generation.",
      endpoint: "infer",
    };
  }

  // VLMs (vision/multimodal hints)
  const isVLM = lower.includes("vlm") || lower.includes("vision") || lower.includes("vl-");
  // Reasoning hints
  const isThinking = lower.includes("thinking") || lower.includes("reasoning") || lower.includes("r1");

  return {
    vendor: vendorLabel,
    displayName: display,
    category: isVLM ? "multimodal" : "reasoning",
    kind: isVLM ? "vlm" : "llm",
    contextWindow: 128_000,
    maxOutput: 8_192,
    supportsImages: isVLM,
    supportsVideo: false,
    supportsTools: true,
    supportsThinking: isThinking,
    thinkingModes: isThinking ? ["off", "high"] : [],
    defaultThinking: isThinking ? "off" : undefined,
    paramHint: "open weights",
    paramCountB: 0,
    license: "See vendor",
    licenseCommercial: true,
    tagline: `${vendorLabel} model.`,
    endpoint: "chat",
    recommendedTemperature: 0.7,
  };
}

function humanizeVendor(slug: string): string {
  const map: Record<string, string> = {
    "deepseek-ai": "DeepSeek",
    moonshotai: "Moonshot AI",
    "z-ai": "Z.ai",
    qwen: "Alibaba",
    meta: "Meta",
    mistralai: "Mistral",
    openai: "OpenAI",
    minimaxai: "MiniMax",
    "black-forest-labs": "Black Forest Labs",
    nvidia: "NVIDIA",
    google: "Google",
    microsoft: "Microsoft",
  };
  return map[slug] ?? slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function humanizeName(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\b(\d+)k\b/gi, "$1K")
    .replace(/instruct\b/gi, "Instruct")
    .replace(/chat\b/gi, "Chat")
    .split(" ")
    .filter(Boolean)
    .map((w) => (/^v?\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
