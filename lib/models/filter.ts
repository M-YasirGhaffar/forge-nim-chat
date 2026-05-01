import "server-only";

/**
 * Auto-categorization for the raw NIM /v1/models list.
 *
 * Strategy:
 *   1. DENY token list — drops embeddings, guardrails, parsers, translators,
 *      classifiers, retrievers. Pattern follows industry naming conventions, so new
 *      models from any vendor that fall in these categories are caught with no edit.
 *   2. VENDOR_DENY — strips vertical/regional fine-tune shops (palmyra-med,
 *      sarvam, stockmark, sea-lion, etc.).
 *   3. EXPLICIT_DENY — a small list of base completion models (codegemma,
 *      starcoder, llama2-base, mixtral-vN.M base) that share id-shape with chat
 *      models and can't be distinguished by token alone.
 *   4. SIZE_FLOOR — drop anything < 12B params (parsed from id, with MoE math
 *      and a small SIZE_HINTS map for ids that hide the count).
 *   5. ULTRA promotion — anything ≥ 300B becomes its own "ultra" tier, so older
 *      huge models (llama-3.1-405b) survive alongside newer smaller siblings
 *      (llama-3.3-70b). Edge case 2 fix from the design discussion.
 *   6. FAMILY GROUPING — group by (vendor, family_codename, specialization);
 *      within each group keep max(generation), then max(size). Specialization is
 *      one of: general, coder, thinking, multimodal, pro, flash, large, medium,
 *      ultra — keeps siblings with different capabilities visible side-by-side.
 *
 * Maintenance is roughly zero for new models from existing vendors. New vendors
 * pass through automatically. Niche fine-tunes from random orgs get filtered by
 * VENDOR_DENY when they become a problem.
 */

const DENY_TOKEN = /\b(embed|embedqa|embedding|nemoretriever|guard|nemoguard|safety|parse|translate|riva|clip|reward|detector|calibration|deplot|kosmos|chatqa|reason2|cosmos|gliner|pii|nvclip|ising|fuyu|neva|vila)\b/i;

const VENDOR_DENY = new Set([
  "abacusai",      // third-party fine-tunes (dracarys, etc.)
  "writer",        // verticals (palmyra-fin, palmyra-med, palmyra-creative)
  "sarvamai",      // Indic-language vertical
  "stockmark",     // Japanese-language vertical
  "aisingapore",   // SEA-language vertical
  "adept",         // legacy research VLMs
  "zyphra",        // research SSM
  "upstage",       // legacy small models
  "ai21labs",      // SSM niche
  "stepfun-ai",    // niche
  "01-ai",         // superseded by Qwen/DeepSeek
  "baai",          // embeddings only
  "snowflake",     // embeddings only
  "bigcode",       // base completion (starcoder)
]);

const EXPLICIT_DENY: RegExp[] = [
  /\bcodegemma\b/i,                         // base completion
  /\brecurrentgemma\b/i,                    // research SSM
  /^google\/gemma-\d+b$/i,                  // gemma-2b without -it
  /^meta\/llama2/i,                         // legacy base
  /^meta\/codellama-/i,                     // 2023 code model, superseded
  /^mistralai\/codestral-/i,                // superseded by devstral-2
  /^mistralai\/mixtral-/i,                  // 2024 mixtures, superseded by mistral-large-3
  /\bnv-embedcode\b/i,                      // embedding
  /\bnemotron-mini\b/i,                     // 4B Nemotron mini
];

/**
 * Models that hide their parameter count from the id. One line per model.
 * Used by detectSize() as a fallback. Add an entry only when an id you actually
 * want surfaced gets dropped by SIZE_FLOOR.
 */
const SIZE_HINTS: Record<string, number> = {
  "deepseek-ai/deepseek-v3.2": 671,
  "deepseek-ai/deepseek-v3.1-terminus": 671,
  "deepseek-ai/deepseek-v4-pro": 1600,
  "deepseek-ai/deepseek-v4-flash": 284,
  "moonshotai/kimi-k2-instruct": 1000,
  "moonshotai/kimi-k2-instruct-0905": 1000,
  "moonshotai/kimi-k2-thinking": 1000,
  "z-ai/glm-5.1": 754,
  "z-ai/glm5": 250,
  "z-ai/glm4.7": 130,
  "minimaxai/minimax-m2.5": 200,
  "minimaxai/minimax-m2.7": 200,
  "stepfun-ai/step-3.5-flash": 300,
  "databricks/dbrx-instruct": 132,
  "mistralai/mistral-nemotron": 70,
  "mistralai/mistral-large": 123,
  "mistralai/mistral-medium-3-instruct": 70,
  "microsoft/phi-3-vision-128k-instruct": 4,
  "microsoft/phi-3.5-moe-instruct": 41,
  "microsoft/phi-4-multimodal-instruct": 5,
  "microsoft/phi-4-mini-instruct": 4,
  "nvidia/mistral-nemo-minitron-8b-8k-instruct": 8,
  "nv-mistralai/mistral-nemo-12b-instruct": 12,
  // Llama 4 Maverick is "17B per expert × 128 experts" — id only says 17b.
  "meta/llama-4-maverick-17b-128e-instruct": 400,
};

const SPEC_RULES: Array<{ re: RegExp; spec: Specialization }> = [
  { re: /\b(coder|code(?:llama|gemma|stral)?|devstral|starcoder)\b/i, spec: "coder" },
  { re: /\b(thinking|reasoning|magistral|r1)\b/i, spec: "thinking" },
  { re: /\b(vision|vlm|vl-?\d|multimodal|omni|maverick)\b/i, spec: "multimodal" },
  { re: /\b(super|pro|max)\b/i, spec: "pro" },
  { re: /\b(flash|nano|mini|small)\b/i, spec: "flash" },
  { re: /\blarge\b/i, spec: "large" },
  { re: /\bmedium\b/i, spec: "medium" },
];

const FAMILY_FILTER_TOKENS = new Set([
  "instruct", "chat", "it", "base",
  "coder", "code", "thinking", "reasoning", "magistral", "r1",
  "vision", "vlm", "multimodal", "omni", "maverick",
  "pro", "max", "ultra", "super",
  "flash", "nano", "mini", "small",
  "large", "medium",
  "creative", "fin", "med", "legal",
  "preview", "beta", "alpha",
]);

const SIZE_FLOOR_B = 12;
const ULTRA_PROMOTE_B = 300;

type Specialization =
  | "general" | "coder" | "thinking" | "multimodal"
  | "pro" | "flash" | "large" | "medium" | "ultra";

interface ParsedId {
  id: string;
  vendor: string;
  family: string;
  spec: Specialization;
  gen: number | null;
  size_b: number | null;
}

function detectSize(name: string, id: string): number | null {
  // MoE expert pattern: "8x22b" → 8 experts × 22B per expert ≈ 176B total
  const moe = name.match(/(\d+)x(\d+)b\b/i);
  if (moe) return parseInt(moe[1], 10) * parseInt(moe[2], 10);
  // Strip MoE active-params marker (a17b), expert count (128e), context (128k)
  // before scanning for the size token.
  const cleaned = name
    .replace(/a\d+b/gi, "")
    .replace(/\d+e\b/gi, "")
    .replace(/\d+k\b/gi, "");
  const m = cleaned.match(/(\d+)b\b/i);
  if (m) return parseInt(m[1], 10);
  return SIZE_HINTS[id] ?? null;
}

function detectGen(name: string): number | null {
  const segs = name.split("-");
  for (const s of segs) {
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    const vm = s.match(/^v(\d+(?:\.\d+)?)$/i);
    if (vm) return parseFloat(vm[1]);
    const im = s.match(/^[a-z]+(\d+(?:\.\d+)?)$/i);
    if (im) return parseFloat(im[1]);
  }
  return null;
}

/**
 * Trailing -vN.M revision suffix used as a tiebreaker when two ids share the
 * same family/spec/gen/size (e.g. nemotron-super-49b-v1 vs -v1.5).
 */
function detectRevision(name: string): number {
  const m = name.match(/-v(\d+(?:\.\d+)?)$/i);
  return m ? parseFloat(m[1]) : 0;
}

function detectSpec(name: string): Specialization {
  for (const { re, spec } of SPEC_RULES) if (re.test(name)) return spec;
  return "general";
}

function detectFamily(vendor: string, name: string): string {
  const tokens = name.split(/[-_]/).filter((t) => {
    const lower = t.toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(t)) return false;          // pure version
    if (/^\d+b$/i.test(t)) return false;                   // size token
    if (/^a\d+b$/i.test(t)) return false;                  // active params
    if (/^\d+x\d+b$/i.test(t)) return false;               // MoE shape
    if (/^v\d+(?:\.\d+)?$/i.test(t)) return false;         // v-prefix version
    if (/^\d{4}$/.test(t)) return false;                   // date suffix
    if (/^\d+e$/i.test(t)) return false;                   // expert count
    if (/^\d+k$/i.test(t)) return false;                   // context window
    if (/^[a-z]+\d+(?:\.\d+)?$/i.test(t)) return false;    // vendor-versioned (qwen3.5)
    if (FAMILY_FILTER_TOKENS.has(lower)) return false;     // spec/variant
    return true;
  });
  if (tokens.length === 0) {
    // Everything got stripped — fall back to the alpha prefix of the first segment
    // (e.g. "qwen3.5-397b-a17b" → "qwen").
    const a = name.split(/[-_]/)[0]?.match(/^([a-z]+)/i);
    if (a) tokens.push(a[1]);
  }
  return `${vendor}/${tokens.join("-").toLowerCase()}`;
}

function parseId(id: string): ParsedId | null {
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const vendor = id.slice(0, slash);
  const name = id.slice(slash + 1);
  if (!name) return null;
  const family = detectFamily(vendor, name);
  let spec: Specialization = detectSpec(name);
  const size_b = detectSize(name, id);
  const gen = detectGen(name);
  // Edge case 2: very large older models (llama-3.1-405b) survive alongside
  // newer smaller siblings (llama-3.3-70b) by getting their own "ultra" group.
  if (size_b !== null && size_b >= ULTRA_PROMOTE_B && (spec === "general" || spec === "pro")) {
    spec = "ultra";
  }
  return { id, vendor, family, spec, gen, size_b };
}

/**
 * Apply all filters to a raw id list. Returns the surviving ids in no particular
 * order — caller sorts.
 */
export function filterAndDedupe(rawIds: string[]): string[] {
  const candidates: ParsedId[] = [];
  const seen = new Set<string>();
  for (const id of rawIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (DENY_TOKEN.test(id)) continue;
    const slash = id.indexOf("/");
    if (slash < 0) continue;
    const vendor = id.slice(0, slash).toLowerCase();
    if (VENDOR_DENY.has(vendor)) continue;
    if (EXPLICIT_DENY.some((re) => re.test(id))) continue;
    const p = parseId(id);
    if (!p) continue;
    if (p.size_b !== null && p.size_b < SIZE_FLOOR_B) continue;
    candidates.push(p);
  }
  // Within each (family, spec) group keep max(gen) → max(size) → max(revision).
  const winners = new Map<string, ParsedId>();
  for (const c of candidates) {
    const key = `${c.family}::${c.spec}`;
    const cur = winners.get(key);
    if (!cur) { winners.set(key, c); continue; }
    if (compareParsed(c, cur) > 0) winners.set(key, c);
  }
  return [...winners.values()].map((p) => p.id);
}

function compareParsed(a: ParsedId, b: ParsedId): number {
  const ag = a.gen ?? 0, bg = b.gen ?? 0;
  if (ag !== bg) return ag - bg;
  const as = a.size_b ?? 0, bs = b.size_b ?? 0;
  if (as !== bs) return as - bs;
  return detectRevision(a.id) - detectRevision(b.id);
}

/**
 * Diagnostic version of filterAndDedupe that also returns the casualty list and
 * group keys. Used by scripts/categorize-models.mjs and any future admin panel.
 */
export function filterWithDiagnostics(rawIds: string[]) {
  const dropped = {
    denyToken: [] as string[],
    vendorDeny: [] as string[],
    explicitDeny: [] as string[],
    tooSmall: [] as string[],
    superseded: [] as Array<{ id: string; winner: string }>,
  };
  const candidates: ParsedId[] = [];
  const seen = new Set<string>();
  for (const id of rawIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (DENY_TOKEN.test(id)) { dropped.denyToken.push(id); continue; }
    const slash = id.indexOf("/");
    if (slash < 0) continue;
    const vendor = id.slice(0, slash).toLowerCase();
    if (VENDOR_DENY.has(vendor)) { dropped.vendorDeny.push(id); continue; }
    if (EXPLICIT_DENY.some((re) => re.test(id))) { dropped.explicitDeny.push(id); continue; }
    const p = parseId(id);
    if (!p) continue;
    if (p.size_b !== null && p.size_b < SIZE_FLOOR_B) {
      dropped.tooSmall.push(`${id} (${p.size_b}B)`);
      continue;
    }
    candidates.push(p);
  }
  const winners = new Map<string, ParsedId>();
  for (const c of candidates) {
    const key = `${c.family}::${c.spec}`;
    const cur = winners.get(key);
    if (!cur) { winners.set(key, c); continue; }
    if (compareParsed(c, cur) > 0) winners.set(key, c);
  }
  for (const c of candidates) {
    const key = `${c.family}::${c.spec}`;
    const w = winners.get(key)!;
    if (w.id !== c.id) dropped.superseded.push({ id: c.id, winner: w.id });
  }
  return { survivors: [...winners.values()], dropped };
}
