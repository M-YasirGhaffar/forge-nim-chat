import "server-only";
import { getAdminDb, FieldValue } from "./admin";
import type { ChatMeta, ChatMessage, ArtifactRecord } from "@/lib/types";
import { nanoid } from "nanoid";

const db = () => getAdminDb();

/**
 * Returns true if Firebase Admin SDK is configured. Without it, persistence is no-oped
 * but streaming still works — the user gets ephemeral chats that disappear on refresh.
 */
function adminConfigured(): boolean {
  return !!(process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}

function warnSkip(action: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[firestore] ${action} skipped — FIREBASE_ADMIN_CLIENT_EMAIL/PRIVATE_KEY not set. Chats will not persist.`);
  }
}

export async function ensureUser(uid: string, payload: {
  email?: string;
  displayName?: string;
  photoUrl?: string;
}) {
  if (!adminConfigured()) {
    warnSkip("ensureUser");
    return null;
  }
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      email: payload.email ?? null,
      displayName: payload.displayName ?? null,
      photoUrl: payload.photoUrl ?? null,
      tier: "free",
      createdAt: FieldValue.serverTimestamp(),
      preferences: {
        lastModel: "deepseek-ai/deepseek-v4-flash",
        thinkingDefault: "high",
        theme: "system",
      },
      totalMessagesAllTime: 0,
      totalTokensAllTime: 0,
    });
  } else {
    await ref.set(
      {
        email: payload.email ?? snap.get("email") ?? null,
        displayName: payload.displayName ?? snap.get("displayName") ?? null,
        photoUrl: payload.photoUrl ?? snap.get("photoUrl") ?? null,
      },
      { merge: true }
    );
  }
  return ref;
}

export async function createChat(uid: string, modelId: string, title?: string): Promise<string> {
  const id = nanoid(12);
  if (!adminConfigured()) {
    warnSkip("createChat");
    return id; // Return an ephemeral id so the rest of the request still flows.
  }
  await db().collection("chats").doc(id).set({
    ownerId: uid,
    title: title ?? "New chat",
    modelLastUsed: modelId,
    archived: false,
    isPublic: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return id;
}

export async function getChat(chatId: string): Promise<ChatMeta | null> {
  if (!adminConfigured()) return null;
  const snap = await db().collection("chats").doc(chatId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    ownerId: d.ownerId as string,
    title: (d.title as string) ?? "Untitled",
    modelLastUsed: (d.modelLastUsed as string) ?? "deepseek-ai/deepseek-v4-flash",
    archived: Boolean(d.archived),
    createdAt: tsToMillis(d.createdAt),
    updatedAt: tsToMillis(d.updatedAt),
  };
}

export async function listUserChats(uid: string, limit = 100): Promise<ChatMeta[]> {
  if (!adminConfigured()) return [];
  const q = await db()
    .collection("chats")
    .where("ownerId", "==", uid)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return q.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      ownerId: data.ownerId,
      title: data.title ?? "Untitled",
      modelLastUsed: data.modelLastUsed ?? "deepseek-ai/deepseek-v4-flash",
      archived: Boolean(data.archived),
      createdAt: tsToMillis(data.createdAt),
      updatedAt: tsToMillis(data.updatedAt),
    };
  });
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  if (!adminConfigured()) return [];
  const q = await db()
    .collection("chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .get();
  return q.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      role: data.role,
      parts: data.parts ?? [],
      model: data.model ?? null,
      thinkingMode: data.thinkingMode ?? null,
      usage: data.usage ?? null,
      finishReason: data.finishReason ?? null,
      createdAt: tsToMillis(data.createdAt),
    } satisfies ChatMessage;
  });
}

export async function getChatArtifacts(chatId: string): Promise<ArtifactRecord[]> {
  if (!adminConfigured()) return [];
  const q = await db().collection("chats").doc(chatId).collection("artifacts").get();
  const out: ArtifactRecord[] = [];
  q.forEach((d) => {
    const data = d.data();
    const versions = (data.versions as Array<{ body: string; createdAt: unknown; createdByMessageId?: string }>) ?? [];
    const idx = (data.currentVersion as number) ?? versions.length - 1;
    const v = versions[idx];
    if (!v) return;
    out.push({
      id: d.id,
      type: data.type,
      title: data.title,
      language: data.language,
      body: v.body,
      version: idx + 1,
      createdAt: tsToMillis(v.createdAt),
      createdByMessageId: v.createdByMessageId,
    });
  });
  return out;
}

export async function persistAssistantMessage(args: {
  chatId: string;
  uid: string;
  message: ChatMessage;
  artifacts: Array<{ id: string; type: ArtifactRecord["type"]; title: string; language?: string; body: string }>;
  modelId: string;
  isFirstTurn?: boolean;
  newTitle?: string;
}) {
  if (!adminConfigured()) {
    warnSkip("persistAssistantMessage");
    return;
  }
  const chatRef = db().collection("chats").doc(args.chatId);
  const batch = db().batch();

  batch.set(chatRef.collection("messages").doc(args.message.id), {
    ownerId: args.uid,
    role: args.message.role,
    parts: args.message.parts,
    model: args.message.model ?? null,
    thinkingMode: args.message.thinkingMode ?? null,
    usage: args.message.usage ?? null,
    finishReason: args.message.finishReason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  for (const a of args.artifacts) {
    const artRef = chatRef.collection("artifacts").doc(a.id);
    const existing = await artRef.get();
    const newVersion = {
      body: a.body,
      createdAt: FieldValue.serverTimestamp(),
      createdByMessageId: args.message.id,
    };
    if (existing.exists) {
      const versions = existing.get("versions") as unknown[];
      const next = [...versions, newVersion];
      batch.update(artRef, {
        versions: next,
        currentVersion: next.length - 1,
        type: a.type,
        title: a.title,
        language: a.language ?? null,
      });
    } else {
      batch.set(artRef, {
        ownerId: args.uid,
        type: a.type,
        title: a.title,
        language: a.language ?? null,
        versions: [newVersion],
        currentVersion: 0,
      });
    }
  }

  const chatUpdate: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    modelLastUsed: args.modelId,
  };
  if (args.newTitle) chatUpdate.title = args.newTitle;
  batch.update(chatRef, chatUpdate);

  // Increment user totals.
  const userRef = db().collection("users").doc(args.uid);
  batch.set(
    userRef,
    {
      totalMessagesAllTime: FieldValue.increment(1),
      totalTokensAllTime: FieldValue.increment(args.message.usage?.totalTokens ?? 0),
      preferences: { lastModel: args.modelId },
    },
    { merge: true }
  );

  // Daily usage.
  const today = new Date().toISOString().slice(0, 10);
  const usageRef = db()
    .collection("usage")
    .doc(args.uid)
    .collection("daily")
    .doc(today);
  batch.set(
    usageRef,
    {
      msgs: FieldValue.increment(1),
      tokens: FieldValue.increment(args.message.usage?.totalTokens ?? 0),
    },
    { merge: true }
  );

  await batch.commit();
}

export async function persistUserMessage(args: {
  chatId: string;
  uid: string;
  message: ChatMessage;
}) {
  if (!adminConfigured()) {
    warnSkip("persistUserMessage");
    return;
  }
  const chatRef = db().collection("chats").doc(args.chatId);
  await chatRef.collection("messages").doc(args.message.id).set({
    ownerId: args.uid,
    role: args.message.role,
    parts: args.message.parts,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteChat(chatId: string) {
  if (!adminConfigured()) return;
  const ref = db().collection("chats").doc(chatId);
  // Delete subcollections first.
  for (const sub of ["messages", "artifacts"]) {
    const snap = await ref.collection(sub).get();
    const batch = db().batch();
    snap.forEach((d) => batch.delete(d.ref));
    if (snap.size > 0) await batch.commit();
  }
  await ref.delete();
}

export async function updateUserPreferences(uid: string, prefs: Partial<{
  lastModel: string;
  thinkingDefault: "off" | "high" | "max";
  theme: "light" | "dark" | "system";
  displayName: string;
}>) {
  if (!adminConfigured()) return;
  const ref = db().collection("users").doc(uid);
  const update: Record<string, unknown> = {};
  if (prefs.lastModel) update["preferences.lastModel"] = prefs.lastModel;
  if (prefs.thinkingDefault) update["preferences.thinkingDefault"] = prefs.thinkingDefault;
  if (prefs.theme) update["preferences.theme"] = prefs.theme;
  if (prefs.displayName) update["displayName"] = prefs.displayName;
  if (Object.keys(update).length > 0) await ref.update(update);
}

function tsToMillis(v: unknown): number {
  if (!v) return Date.now();
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "object" && v && "seconds" in v) {
    const s = (v as { seconds: number; nanoseconds?: number });
    return s.seconds * 1000 + Math.floor((s.nanoseconds ?? 0) / 1e6);
  }
  return Date.now();
}
