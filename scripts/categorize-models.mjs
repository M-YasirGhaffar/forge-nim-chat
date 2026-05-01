// Run-once probe: fetches NIM /v1/models live and applies the auto-categorization
// algorithm in lib/models/filter.ts (logic mirrored here since .ts uses server-only).
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const KEY = env.match(/NVIDIA_API_KEY=(.+)/)?.[1]?.trim();

const DENY_TOKEN = /\b(embed|embedqa|embedding|nemoretriever|guard|nemoguard|safety|parse|translate|riva|clip|reward|detector|calibration|deplot|kosmos|chatqa|reason2|cosmos|gliner|pii|nvclip|ising|fuyu|neva|vila)\b/i;

const VENDOR_DENY = new Set([
  "abacusai", "writer", "sarvamai", "stockmark", "aisingapore",
  "adept", "zyphra", "upstage", "ai21labs", "stepfun-ai",
  "01-ai", "baai", "snowflake", "bigcode",
]);

const EXPLICIT_DENY = [
  /\bcodegemma\b/i,
  /\brecurrentgemma\b/i,
  /^google\/gemma-\d+b$/i,
  /^meta\/llama2/i,
  /^meta\/codellama-/i,
  /^mistralai\/codestral-/i,
  /^mistralai\/mixtral-/i,
  /\bnv-embedcode\b/i,
  /\bnemotron-mini\b/i,
];

const SIZE_HINTS = {
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
  "meta/llama-4-maverick-17b-128e-instruct": 400,
};

const SPEC_RULES = [
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

function detectSize(name, id) {
  const moe = name.match(/(\d+)x(\d+)b\b/i);
  if (moe) return parseInt(moe[1], 10) * parseInt(moe[2], 10);
  const cleaned = name.replace(/a\d+b/gi, "").replace(/\d+e\b/gi, "").replace(/\d+k\b/gi, "");
  const m = cleaned.match(/(\d+)b\b/i);
  if (m) return parseInt(m[1], 10);
  return SIZE_HINTS[id] ?? null;
}

function detectGen(name) {
  for (const s of name.split("-")) {
    if (/^\d+(?:\.\d+)?$/.test(s)) return parseFloat(s);
    const vm = s.match(/^v(\d+(?:\.\d+)?)$/i);
    if (vm) return parseFloat(vm[1]);
    const im = s.match(/^[a-z]+(\d+(?:\.\d+)?)$/i);
    if (im) return parseFloat(im[1]);
  }
  return null;
}

function detectSpec(name) {
  for (const { re, spec } of SPEC_RULES) if (re.test(name)) return spec;
  return "general";
}

function detectFamily(vendor, name) {
  const tokens = name.split(/[-_]/).filter((t) => {
    const lower = t.toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(t)) return false;
    if (/^\d+b$/i.test(t)) return false;
    if (/^a\d+b$/i.test(t)) return false;
    if (/^\d+x\d+b$/i.test(t)) return false;
    if (/^v\d+(?:\.\d+)?$/i.test(t)) return false;
    if (/^\d{4}$/.test(t)) return false;
    if (/^\d+e$/i.test(t)) return false;
    if (/^\d+k$/i.test(t)) return false;
    if (/^[a-z]+\d+(?:\.\d+)?$/i.test(t)) return false;
    if (FAMILY_FILTER_TOKENS.has(lower)) return false;
    return true;
  });
  if (tokens.length === 0) {
    const a = name.split(/[-_]/)[0]?.match(/^([a-z]+)/i);
    if (a) tokens.push(a[1]);
  }
  return `${vendor}/${tokens.join("-").toLowerCase()}`;
}

function parseId(id) {
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const vendor = id.slice(0, slash);
  const name = id.slice(slash + 1);
  if (!name) return null;
  const family = detectFamily(vendor, name);
  let spec = detectSpec(name);
  const size_b = detectSize(name, id);
  const gen = detectGen(name);
  if (size_b !== null && size_b >= ULTRA_PROMOTE_B && (spec === "general" || spec === "pro")) {
    spec = "ultra";
  }
  return { id, vendor, family, spec, gen, size_b, name };
}

const res = await fetch("https://integrate.api.nvidia.com/v1/models", { headers: { Authorization: `Bearer ${KEY}` } });
const json = await res.json();
const ids = [...new Set((json.data || []).map((d) => d.id))].sort();

const dropped = { denyToken: [], vendorDeny: [], explicitDeny: [], tooSmall: [] };
const candidates = [];

for (const id of ids) {
  if (DENY_TOKEN.test(id)) { dropped.denyToken.push(id); continue; }
  const slash = id.indexOf("/");
  if (slash < 0) continue;
  const vendor = id.slice(0, slash).toLowerCase();
  if (VENDOR_DENY.has(vendor)) { dropped.vendorDeny.push(id); continue; }
  if (EXPLICIT_DENY.some((re) => re.test(id))) { dropped.explicitDeny.push(id); continue; }
  const p = parseId(id);
  if (!p) continue;
  if (p.size_b !== null && p.size_b < SIZE_FLOOR_B) {
    dropped.tooSmall.push(`${id}  (${p.size_b}B)`);
    continue;
  }
  candidates.push(p);
}

function detectRevision(name) {
  const m = name.match(/-v(\d+(?:\.\d+)?)$/i);
  return m ? parseFloat(m[1]) : 0;
}
function compareParsed(a, b) {
  const ag = a.gen ?? 0, bg = b.gen ?? 0;
  if (ag !== bg) return ag - bg;
  const as = a.size_b ?? 0, bs = b.size_b ?? 0;
  if (as !== bs) return as - bs;
  return detectRevision(a.name) - detectRevision(b.name);
}
const winners = new Map();
for (const c of candidates) {
  const key = `${c.family}::${c.spec}`;
  const cur = winners.get(key);
  if (!cur) { winners.set(key, c); continue; }
  if (compareParsed(c, cur) > 0) winners.set(key, c);
}

const winnerIds = new Set([...winners.values()].map((p) => p.id));
const superseded = candidates.filter((c) => !winnerIds.has(c.id));
const survivors = [...winners.values()].sort((a, b) => a.id.localeCompare(b.id));

console.log("=== SURVIVORS (" + survivors.length + ") ===");
for (const s of survivors) {
  console.log(`  ${s.id.padEnd(60)}  spec=${s.spec.padEnd(11)} gen=${String(s.gen ?? "-").padEnd(5)} size=${s.size_b ?? "?"}B   family=${s.family}`);
}

console.log("\n=== DROPPED: deny-token (" + dropped.denyToken.length + ") ===");
for (const id of dropped.denyToken) console.log(`  ${id}`);

console.log("\n=== DROPPED: vendor-deny (" + dropped.vendorDeny.length + ") ===");
for (const id of dropped.vendorDeny) console.log(`  ${id}`);

console.log("\n=== DROPPED: explicit-deny / base model (" + dropped.explicitDeny.length + ") ===");
for (const id of dropped.explicitDeny) console.log(`  ${id}`);

console.log("\n=== DROPPED: < " + SIZE_FLOOR_B + "B (" + dropped.tooSmall.length + ") ===");
for (const id of dropped.tooSmall) console.log(`  ${id}`);

console.log("\n=== DROPPED: superseded within family (" + superseded.length + ") ===");
for (const c of superseded) {
  const w = winners.get(`${c.family}::${c.spec}`);
  console.log(`  ${c.id.padEnd(60)}  →  ${w.id}`);
}

console.log("\nCounts:  total=" + ids.length + "  survivors=" + survivors.length + "  denied=" + (dropped.denyToken.length + dropped.vendorDeny.length + dropped.explicitDeny.length) + "  small=" + dropped.tooSmall.length + "  superseded=" + superseded.length);
