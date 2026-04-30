import "server-only";
import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let app: App | null = null;

function getPrivateKey(): string {
  const raw = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  // Vercel UI escapes \n as literal \n strings — unescape.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function getAdminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApp();
    return app;
  }
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!projectId) throw new Error("FIREBASE_ADMIN_PROJECT_ID missing");
  if (!clientEmail || !privateKey) {
    // Allow init without service account in dev (auth-disabled mode).
    // Throws will surface in route handlers that actually need Admin.
    throw new Error(
      "Firebase Admin credentials missing. Set FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY in .env.local or Vercel env."
    );
  }

  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
  return app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminStorage() {
  return getStorage(getAdminApp());
}

export { FieldValue, Timestamp };
