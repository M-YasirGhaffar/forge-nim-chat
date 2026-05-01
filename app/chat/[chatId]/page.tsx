import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/firebase/session";
import { getChat, getChatMessages, getChatArtifacts } from "@/lib/firebase/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { ChatShell } from "@/components/chat/chat-shell";
import type { ChatMessage, ThinkingMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  // No server-side redirect — auth is enforced client-side. When the session cookie is absent
  // (e.g. Firebase Admin not configured) we still render the shell; the AuthProvider on the
  // client will redirect to /login if needed, and the chat shell loads its own data via API.
  const user = await getSessionUser().catch(() => null);
  const { chatId } = await params;

  let initialMessages: ChatMessage[] = [];
  let initialArtifacts: import("@/lib/types").ArtifactRecord[] = [];
  let initialTitle = "New chat";
  let lastModel: string | undefined;
  let thinkingDefault: ThinkingMode | undefined;

  if (user) {
    let chatExists = true;
    try {
      const chat = await getChat(chatId);
      if (!chat || chat.ownerId !== user.uid) {
        // Task 60: surface 404 for missing or unauthorized chat ids instead of
        // falling through to a blank shell.
        chatExists = false;
      } else {
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
      // ignore — fall back to client-side load (avoids 404 if firestore admin is misconfigured).
      chatExists = true;
    }
    if (!chatExists) notFound();

    // Task 61: detect interrupted-stream recovery — when the latest message is a
    // user message with no assistant follow-up, append a synthetic empty assistant
    // bubble so MessageView renders the recovery notice.
    if (initialMessages.length > 0) {
      const last = initialMessages[initialMessages.length - 1];
      if (last.role === "user") {
        initialMessages = [
          ...initialMessages,
          {
            id: `interrupted-${last.id}`,
            role: "assistant",
            parts: [],
            model: lastModel,
            createdAt: (last.createdAt ?? Date.now()) + 1,
            finishReason: "interrupted",
          } as ChatMessage,
        ];
      }
    }
  }

  // key={chatId} forces a remount when navigating /chat/A → /chat/B so
  // useChatStream re-initializes from the new initialMessages. Without the key,
  // Next.js App Router would preserve the client component instance and the
  // previous chat's messages would linger.
  return (
    <ChatShell
      key={chatId}
      chatId={chatId}
      initialMessages={initialMessages}
      initialArtifacts={initialArtifacts}
      initialTitle={initialTitle}
      initialModelId={lastModel}
      initialThinking={thinkingDefault}
    />
  );
}
