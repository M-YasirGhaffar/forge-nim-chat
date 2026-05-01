// Provisions a Firebase Storage default bucket non-interactively using the
// service-account credentials already in .env.local.
//
// Strategy:
//   1. Try the "add Firebase to a Cloud Storage bucket" REST endpoint at the
//      conventional default name (`<project>.firebasestorage.app` for projects
//      created after Oct 2024, `<project>.appspot.com` for older ones). If that
//      bucket already exists in GCS but isn't yet linked to Firebase, this links it.
//   2. If both bucket names 404 (no GCS bucket exists at all), call the project
//      finalize-location endpoint which provisions the default Storage bucket.
//
// Run:
//   node --env-file=.env.local scripts/provision-storage.mjs <region?>
// Where <region> defaults to "us-central1".

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
const region = process.argv[2] || "us-central1";

if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing FIREBASE_ADMIN_* env vars");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

/**
 * Mint an access token. Prefer the user-auth token from the firebase CLI
 * (~/.config/configstore/firebase-tools.json) because it inherits the human's
 * Owner role on the project — the service account we have lacks the
 * `firebase.projects.update` permission needed for `defaultLocation:finalize`.
 * Fall back to the service account if the CLI isn't logged in.
 */
async function mintToken() {
  const cli = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (fs.existsSync(cli)) {
    try {
      const data = JSON.parse(fs.readFileSync(cli, "utf8"));
      const t = data?.tokens;
      if (t?.access_token && t.expires_at && t.expires_at - Date.now() > 60_000) {
        console.log(`using firebase-cli user auth (${data.user?.email})`);
        return t.access_token;
      }
      // Token expired — refresh via Firebase CLI's known public OAuth client.
      if (t?.refresh_token) {
        console.log("refreshing firebase-cli user token ...");
        const params = new URLSearchParams({
          client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
          client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
          refresh_token: t.refresh_token,
          grant_type: "refresh_token",
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.access_token) {
            console.log(`refreshed firebase-cli user auth (${data.user?.email})`);
            return j.access_token;
          }
        }
      }
    } catch (e) {
      console.warn("firebase-cli token unusable:", e.message);
    }
  }
  console.log("falling back to service-account auth");
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/firebase",
    ],
  });
  const client = await auth.getClient();
  const tokenInfo = await client.getAccessToken();
  if (!tokenInfo.token) throw new Error("could not mint access token");
  return tokenInfo.token;
}

const token = await mintToken();

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

console.log("project:", projectId, "region:", region);

// 1. Check what GCS buckets already exist for this project.
const list = await api(
  "GET",
  `https://storage.googleapis.com/storage/v1/b?project=${projectId}`,
);
console.log("\nexisting GCS buckets:");
const items = list.body?.items ?? [];
if (items.length === 0) console.log("  (none)");
for (const b of items) console.log("  -", b.name, `(${b.location})`);

const candidateNames = [
  `${projectId}.firebasestorage.app`,
  `${projectId}.appspot.com`,
];

let chosen = items.find((b) => candidateNames.includes(b.name))?.name;

// 2. If no candidate bucket exists in GCS, try the Firebase project finalize-location
//    endpoint, which provisions the default Storage bucket *and* works on the Spark
//    (free) tier — unlike the raw Cloud Storage API which requires billing enabled.
if (!chosen) {
  console.log(`\nfinalizing Firebase project location to ${region} ...`);
  const finalize = await api(
    "POST",
    `https://firebase.googleapis.com/v1beta1/projects/${projectId}/defaultLocation:finalize`,
    { locationId: region },
  );
  console.log("  status:", finalize.status);
  console.log("  body:", JSON.stringify(finalize.body).slice(0, 400));
  if (finalize.status >= 400 && finalize.status !== 409) {
    // 409 = already finalized. Anything else is fatal.
    console.error("\n❌ Could not provision default storage bucket via API.");
    console.error("Open this URL in a browser and click 'Get started':");
    console.error(`  https://console.firebase.google.com/project/${projectId}/storage`);
    process.exit(1);
  }
  // Re-list buckets to pick up the newly-created one.
  const relist = await api(
    "GET",
    `https://storage.googleapis.com/storage/v1/b?project=${projectId}`,
  );
  const items2 = relist.body?.items ?? [];
  chosen = items2.find((b) => candidateNames.includes(b.name))?.name;
  if (!chosen && items2[0]) chosen = items2[0].name;
  if (!chosen) {
    console.error("\n❌ Finalize succeeded but no bucket appeared. Wait 30s and re-run.");
    process.exit(1);
  }
}

// 3. Link the bucket to Firebase Storage (idempotent — 200 if already linked).
console.log(`\nlinking ${chosen} to Firebase Storage ...`);
const link = await api(
  "POST",
  `https://firebasestorage.googleapis.com/v1beta/projects/${projectId}/buckets/${chosen}:addFirebase`,
  {},
);
console.log("  status:", link.status);
if (link.status >= 400 && link.status !== 409) {
  console.error("  body:", link.body);
  process.exit(1);
}

// 4. Verify via Admin SDK.
console.log("\nverifying via Admin SDK ...");
const [exists] = await getStorage().bucket(chosen).exists();
console.log(`  ${chosen} → exists: ${exists}`);

console.log(`\n✅ Done. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${chosen} in .env.local if not already.`);
