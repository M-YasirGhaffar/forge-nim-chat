// Adds a domain to Firebase Auth authorizedDomains via Identity Toolkit Admin API.
//
// Run:
//   node --env-file=.env.local scripts/add-authorized-domain.mjs <domain>
// Example:
//   node --env-file=.env.local scripts/add-authorized-domain.mjs forge-nim-chat.vercel.app

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
const domain = process.argv[2];

if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing FIREBASE_ADMIN_* env vars");
  process.exit(1);
}
if (!domain) {
  console.error("Usage: node scripts/add-authorized-domain.mjs <domain>");
  process.exit(1);
}

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
const baseUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;

console.log(`fetching current Auth config for ${projectId} ...`);
const getRes = await fetch(baseUrl, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!getRes.ok) {
  console.error(`GET failed: ${getRes.status} ${await getRes.text()}`);
  process.exit(1);
}
const config = await getRes.json();
const current = config.authorizedDomains ?? [];
console.log(`current authorizedDomains (${current.length}):`);
for (const d of current) console.log(`  - ${d}`);

if (current.includes(domain)) {
  console.log(`\n[OK] ${domain} already in authorizedDomains — nothing to do.`);
  process.exit(0);
}

const updated = [...current, domain];
console.log(`\nadding "${domain}" ...`);

const patchRes = await fetch(`${baseUrl}?updateMask=authorizedDomains`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ authorizedDomains: updated }),
});
if (!patchRes.ok) {
  console.error(`PATCH failed: ${patchRes.status} ${await patchRes.text()}`);
  process.exit(1);
}
const after = await patchRes.json();
console.log(`\n[OK] updated authorizedDomains (${after.authorizedDomains.length}):`);
for (const d of after.authorizedDomains) console.log(`  - ${d}`);
