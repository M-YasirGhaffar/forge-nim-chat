import { getSessionUser } from "@/lib/firebase/session";
import { getChat, getChatMessages, getChatArtifacts } from "@/lib/firebase/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChatShell } from "@/components/chat/chat-shell";
import type { ThinkingMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  // No server-side redirect — auth is enforced client-side. When the session cookie is absent
  // (e.g. Firebase Admin not configured) we still render the shell; the AuthProvider on the
  // client will redirect to /login if needed, and the chat shell loads its own data via API.
  const user = await getSessionUser().catch(() => null);
  const { chatId } = await params;

  let initialMessages: import("@/lib/types").ChatMessage[] = [];
  let initialArtifacts: import("@/lib/types").ArtifactRecord[] = [];
  let initialTitle = "New chat";
  let lastModel: string | undefined;
  let thinkingDefault: ThinkingMode | undefined;

  if (user) {
    try {
      const chat = await getChat(chatId);
      if (chat && chat.ownerId === user.uid) {
        initialTitle = chat.title;
        lastModel = chat.modelLastUsed;
        const [messages, artifacts] = await Promise.all([
          getChatMessages(chatId),
          getChatArtifacts(chatId),
        ]);
        initialMessages = messages;
        initialArtifacts = artifacts;
      }
      const userSnap = await getAdminDb().collection("users").doc(user.uid).get();
      if (userSnap.exists) {
        const prefs = userSnap.get("preferences") || {};
        thinkingDefault = prefs.thinkingDefault;
        if (!lastModel) lastModel = prefs.lastModel;
      }
    } catch {
      // ignore — fall back to client-side load
    }
  }

  return (
    <ChatShell
      chatId={chatId}
      initialMessages={initialMessages}
      initialArtifacts={initialArtifacts}
      initialTitle={initialTitle}
      initialModelId={lastModel}
      initialThinking={thinkingDefault}
    />
  );
}
