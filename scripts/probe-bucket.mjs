// Diagnostic: print which bucket name the Firebase Admin SDK can actually reach.
// Run with: node --env-file=.env.local scripts/probe-bucket.mjs
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const projectId =
  process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
const envBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

console.log("env bucket:", envBucket);
console.log("project:", projectId);

if (!getApps().length) {
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
    storageBucket: envBucket,
  });
}

const candidates = [
  envBucket,
  `${projectId}.firebasestorage.app`,
  `${projectId}.appspot.com`,
];

for (const name of candidates) {
  try {
    const bucket = getStorage().bucket(name);
    const [exists] = await bucket.exists();
    console.log(`  ${name} → exists: ${exists}`);
  } catch (e) {
    console.log(`  ${name} → error: ${e.message}`);
  }
}
