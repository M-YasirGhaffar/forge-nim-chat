"use client";

import { useCallback, useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  type Timestamp,
  type FirestoreError,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import type { ChatMeta } from "@/lib/types";

/**
 * Live subscription to the user's chats collection.
 * Falls back to silent retry if security rules / network blip the listener.
 *
 * Returns `removeChat(id)` for optimistic removal — the Firestore listener can
 * lag a second behind the DELETE response, so the sidebar removes the row
 * locally as soon as the API succeeds. The next snapshot tick confirms.
 */
export function useChats(uid: string | null | undefined) {
  const [chats, setChats] = useState<ChatMeta[] | null>(uid ? null : []);
  const [error, setError] = useState<string | null>(null);

  const removeChat = useCallback((id: string) => {
    setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
  }, []);

  useEffect(() => {
    if (!uid) {
      setChats([]);
      return;
    }
    setChats(null);
    setError(null);

    const db = getClientDb();
    const q = query(
      collection(db, "chats"),
      where("ownerId", "==", uid),
      orderBy("updatedAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ChatMeta[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            ownerId: data.ownerId as string,
            title: (data.title as string) ?? "Untitled",
            modelLastUsed: (data.modelLastUsed as string) ?? "",
            archived: Boolean(data.archived),
            createdAt: tsToMillis(data.createdAt as Timestamp | undefined),
            updatedAt: tsToMillis(data.updatedAt as Timestamp | undefined),
          };
        });
        setChats(list);
        setError(null);
      },
      (err: FirestoreError) => {
        // permission-denied = security rules; failed-precondition = missing index.
        let msg = err.message;
        if (err.code === "permission-denied") {
          msg = "Couldn't read chats — check Firestore rules are deployed.";
        } else if (err.code === "failed-precondition") {
          // Firestore embeds a one-click "create this index" URL in the error message.
          // Surface it verbatim so the user can click it instead of running CLI.
          const urlMatch = err.message.match(/https?:\/\/console\.firebase\.google\.com\/[^\s)]+/);
          msg = urlMatch
            ? `Missing Firestore index. Click to create: ${urlMatch[0]}`
            : "Missing Firestore index. Run: firebase deploy --only firestore:indexes";
        }
        setError(msg);
        setChats([]);
      }
    );
    return () => unsub();
  }, [uid]);

  return { chats, error, removeChat };
}

function tsToMillis(t: Timestamp | undefined): number {
  if (!t) return Date.now();
  if (typeof t === "number") return t;
  if (typeof t === "object" && "toMillis" in t && typeof (t as { toMillis: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}
