// Sets CORS rules on the project's default Cloud Storage bucket so the browser
// can PUT files directly to GCS via the signed URLs minted in /api/files.
//
// Run:
//   node --env-file=.env.local scripts/set-storage-cors.mjs
//
// You can pass an extra origin as argv[2] to add to the default allow-list.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
const envBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

if (!projectId || !clientEmail || !privateKey || !envBucket) {
  console.error("Missing FIREBASE_ADMIN_* / NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET env vars");
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
    storageBucket: envBucket,
  });
}

const extra = process.argv[2];
const origins = [
  "*",
];
if (extra) origins.push(extra);

const corsRules = [
  {
    origin: origins,
    method: ["GET", "HEAD", "PUT", "POST", "OPTIONS", "DELETE"],
    responseHeader: [
      "Content-Type",
      "Authorization",
      "x-goog-meta-*",
      "x-goog-resumable",
    ],
    maxAgeSeconds: 3600,
  },
];

const bucket = getStorage().bucket(envBucket);
console.log(`setting CORS on ${envBucket} ...`);
await bucket.setCorsConfiguration(corsRules);
const [meta] = await bucket.getMetadata();
console.log("done. current CORS:");
console.log(JSON.stringify(meta.cors, null, 2));
