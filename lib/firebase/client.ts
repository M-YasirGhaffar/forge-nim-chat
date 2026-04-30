"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID!,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let appCheck: AppCheck | null = null;

function ensureApp(): FirebaseApp {
  if (app) return app;
  app = getApps()[0] ?? initializeApp(firebaseConfig);
  return app;
}

export function getClientApp(): FirebaseApp {
  return ensureApp();
}

export function getClientAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(ensureApp());
  return auth;
}

export function getClientDb(): Firestore {
  if (db) return db;
  db = getFirestore(ensureApp());
  return db;
}

export function getClientStorage(): FirebaseStorage {
  if (storage) return storage;
  storage = getStorage(ensureApp());
  return storage;
}

export function ensureAppCheck(): AppCheck | null {
  if (typeof window === "undefined") return null;
  if (appCheck) return appCheck;

  // Dev: enable debug token so you can develop without enrolling reCAPTCHA.
  if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_APPCHECK_DEBUG === "true") {
    // @ts-expect-error - global injected by Firebase JS SDK in dev
    window.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) {
    // App Check not configured — skip silently in dev. Production should set the site key.
    if (process.env.NODE_ENV === "production") {
      console.warn("[appcheck] missing NEXT_PUBLIC_RECAPTCHA_SITE_KEY — App Check disabled");
    }
    return null;
  }

  try {
    appCheck = initializeAppCheck(ensureApp(), {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return appCheck;
  } catch (e) {
    console.warn("[appcheck] init failed:", e);
    return null;
  }
}
