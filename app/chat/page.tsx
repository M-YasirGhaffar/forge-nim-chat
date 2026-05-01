import { getSessionUser } from "@/lib/firebase/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChatShell } from "@/components/chat/chat-shell";
import type { ThinkingMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewChatPage() {
  // We do NOT redirect server-side — auth is verified client-side by AuthProvider.
  // Server-side redirect would loop when Firebase Admin isn't configured (no session cookie can be set).
  const user = await getSessionUser().catch(() => null);

  let lastModel: string | undefined;
  let thinkingDefault: ThinkingMode | undefined;
  if (user) {
    try {
      const snap = await getAdminDb().collection("users").doc(user.uid).get();
      if (snap.exists) {
        const prefs = snap.get("preferences") || {};
        lastModel = prefs.lastModel;
        thinkingDefault = prefs.thinkingDefault;
      }
    } catch {
      // ignore — first-time visit before Firestore record exists, or Admin SDK not configured
    }
  }

  return (
    <ChatShell
      key="new"
      chatId={null}
      initialMessages={[]}
      initialArtifacts={[]}
      initialTitle="New chat"
      initialModelId={lastModel}
      initialThinking={thinkingDefault}
    />
  );
}
