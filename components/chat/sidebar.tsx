"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  MessageSquare,
  PanelLeftClose,
  Settings,
  Loader2,
  LogOut,
  Search,
  Pencil,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { useAuth, authedFetch } from "@/components/auth-provider";
import { useChats } from "@/lib/chat/use-chats";
import type { ChatMeta } from "@/lib/types";
import { chatGroup, cn } from "@/lib/utils";
import { getModel } from "@/lib/models/registry";
import { toast } from "sonner";

interface Props {
  activeChatId: string | null;
  onCollapse: () => void;
}

export function ChatSidebar({ activeChatId, onCollapse }: Props) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { chats, error } = useChats(user?.uid);
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!chats) return null;
    const q = search.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [chats, search]);

  const grouped = useMemo(() => {
    if (!filtered) return {} as Record<string, ChatMeta[]>;
    return filtered.reduce<Record<string, ChatMeta[]>>((acc, c) => {
      const g = chatGroup(new Date(c.updatedAt));
      (acc[g] ||= []).push(c);
      return acc;
    }, {});
  }, [filtered]);
  const groupOrder = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"];

  async function deleteChat(id: string) {
    if (!confirm("Delete this chat? This cannot be undone.")) return;
    const res = await authedFetch(`/api/chats/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeChatId === id) router.push("/chat");
      toast.success("Chat deleted.");
    } else {
      toast.error("Could not delete chat.");
    }
  }

  async function renameChat(id: string, newTitle: string) {
    const trimmed = newTitle.trim().slice(0, 120);
    if (!trimmed) return;
    setRenameTarget(null);
    const res = await authedFetch(`/api/chats/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) toast.error("Rename failed");
  }

  // Listen for legacy refresh events as a no-op (subscription is live now).
  useEffect(() => {
    const noop = () => {};
    window.addEventListener("polyglot:refresh-chats", noop);
    return () => window.removeEventListener("polyglot:refresh-chats", noop);
  }, []);

  return (
    <aside className="h-full w-[260px] shrink-0 border-r flex flex-col bg-[rgb(var(--color-bg-elev))]">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[14px]">
          <Logo />
          <span>Polyglot</span>
        </Link>
        <div className="flex-1" />
        <button
          onClick={onCollapse}
          className="btn btn-ghost h-7 w-7 p-0"
          title="Collapse sidebar (Ctrl+B)"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-2 pt-2">
        <button
          onClick={() => {
            // Hard nav, not router.push: the URL is updated mid-stream via
            // history.replaceState (to avoid remounting the streaming fetch), which
            // leaves Next's internal pathname stuck at "/chat". A router.push("/chat")
            // from there is a no-op. window.location.assign always navigates.
            if (window.location.pathname === "/chat") {
              // Already on the new-chat shell — clear state by reloading.
              window.location.reload();
            } else {
              window.location.assign("/chat");
            }
          }}
          className="btn btn-secondary w-full justify-start"
        >
          <Plus className="h-4 w-4" />
          New chat
          <span className="ml-auto text-[10px] opacity-50 font-mono">⌘⇧O</span>
        </button>
      </div>

      {chats && chats.length > 4 && (
        <div className="px-2 pt-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="search"
              placeholder="Search chats…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input h-8 pl-8 text-[12px] py-0"
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-1 pt-2 pb-2 scroll-fade-bottom">
        {chats === null && !error && (
          <div className="px-3 py-4 text-sm flex items-center gap-2" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chats…
          </div>
        )}

        {error && (
          <div className="mx-2 my-2 p-3 rounded-lg border border-[rgb(var(--color-warning)/0.4)] bg-[rgb(var(--color-warning)/0.06)] text-xs" style={{ color: "rgb(var(--color-fg-muted))" }}>
            <div className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "rgb(var(--color-warning))" }} />
              <div className="min-w-0">
                <div className="font-medium" style={{ color: "rgb(var(--color-fg))" }}>Couldn&apos;t load chats</div>
                <div className="mt-1 leading-snug break-words">
                  {(() => {
                    const urlMatch = error.match(/https?:\/\/[^\s)]+/);
                    if (!urlMatch) return error;
                    const [before, after] = error.split(urlMatch[0]);
                    return (
                      <>
                        {before}
                        <a
                          href={urlMatch[0]}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-[rgb(var(--color-accent))]"
                        >
                          create index ↗
                        </a>
                        {after}
                      </>
                    );
                  })()}
                </div>
                <button
                  onClick={() => location.reload()}
                  className="btn btn-ghost h-6 px-1.5 text-[11px] -ml-1.5 mt-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Reload
                </button>
              </div>
            </div>
          </div>
        )}

        {chats !== null && chats.length === 0 && !error && (
          <div className="px-3 py-6 text-[13px] text-center" style={{ color: "rgb(var(--color-fg-muted))" }}>
            No chats yet.<br />
            Send a message to get started.
          </div>
        )}

        {chats !== null &&
          filtered !== null &&
          filtered.length === 0 &&
          chats.length > 0 &&
          search && (
            <div className="px-3 py-4 text-[13px] text-center" style={{ color: "rgb(var(--color-fg-muted))" }}>
              No chats match &ldquo;{search}&rdquo;.
            </div>
          )}

        {chats !== null &&
          groupOrder.map((g) =>
            grouped[g] ? (
              <div key={g} className="mb-2">
                <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider font-medium" style={{ color: "rgb(var(--color-fg-subtle))" }}>
                  {g}
                </div>
                <ul className="space-y-0.5">
                  {grouped[g].map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      active={c.id === activeChatId}
                      isRenaming={renameTarget === c.id}
                      onStartRename={() => setRenameTarget(c.id)}
                      onCancelRename={() => setRenameTarget(null)}
                      onCommitRename={(name) => void renameChat(c.id, name)}
                      onDelete={() => void deleteChat(c.id)}
                    />
                  ))}
                </ul>
              </div>
            ) : null
          )}
      </div>

      <div className="border-t p-2 flex items-center gap-2">
        {user?.photoURL ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={user.photoURL} alt="" className="h-7 w-7 rounded-full border" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[rgb(var(--color-accent))] to-[rgb(var(--color-accent)/0.5)] grid place-items-center text-[11px] font-semibold border text-white">
            {(user?.displayName || user?.email || "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] truncate font-medium">{user?.displayName || user?.email}</div>
          <div className="text-[10px] truncate" style={{ color: "rgb(var(--color-fg-subtle))" }}>{user?.email}</div>
        </div>
        <Link href="/settings" className="btn btn-ghost h-7 w-7 p-0" title="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={() => void signOut().then(() => router.push("/"))}
          className="btn btn-ghost h-7 w-7 p-0"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}

function ChatRow({
  chat,
  active,
  isRenaming,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onDelete,
}: {
  chat: ChatMeta;
  active: boolean;
  isRenaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (name: string) => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(chat.title);
  const model = getModel(chat.modelLastUsed);

  useEffect(() => {
    if (isRenaming) {
      setDraft(chat.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isRenaming, chat.title]);

  if (isRenaming) {
    return (
      <li>
        <div
          className={cn(
            "flex items-center gap-2 px-2.5 mx-1 rounded-md text-[13px] h-8",
            "bg-[rgb(var(--color-bg-soft))] ring-1 ring-[rgb(var(--color-accent)/0.4)]"
          )}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onCommitRename(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename(draft);
              }
              if (e.key === "Escape") onCancelRename();
            }}
            maxLength={120}
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px]"
          />
        </div>
      </li>
    );
  }

  return (
    <li className="group/item">
      <Link
        href={`/chat/${chat.id}`}
        className={cn(
          "flex items-center gap-2 px-2.5 mx-1 rounded-md text-[13px] h-9 transition-colors",
          active
            ? "bg-[rgb(var(--color-bg-soft))] text-[rgb(var(--color-fg))]"
            : "text-[rgb(var(--color-fg-muted))] hover:bg-[rgb(var(--color-bg-soft))] hover:text-[rgb(var(--color-fg))]"
        )}
      >
        <ModelDot vendor={model?.vendor} />
        <span className="flex-1 truncate">{chat.title || "Untitled"}</span>
        <span className="opacity-0 group-hover/item:opacity-100 flex items-center gap-0.5 transition-opacity">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartRename();
            }}
            className="p-1 rounded hover:bg-[rgb(var(--color-border))]"
            title="Rename"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded hover:bg-[rgb(var(--color-danger)/0.15)] hover:text-[rgb(var(--color-danger))]"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      </Link>
    </li>
  );
}

function ModelDot({ vendor }: { vendor?: string }) {
  // Vendor-coded color so users can scan history at a glance.
  const colors: Record<string, string> = {
    DeepSeek: "rgb(70 95 255)",
    "Moonshot AI": "rgb(255 130 60)",
    "Z.ai": "rgb(60 200 130)",
    Alibaba: "rgb(190 80 200)",
    Meta: "rgb(60 130 255)",
    Mistral: "rgb(255 105 50)",
    OpenAI: "rgb(110 110 120)",
    "Black Forest Labs": "rgb(0 0 0)",
    MiniMax: "rgb(220 80 60)",
  };
  const c = vendor ? colors[vendor] : null;
  return (
    <span
      className="block h-1.5 w-1.5 rounded-full shrink-0"
      style={{ backgroundColor: c || "rgb(var(--color-fg-subtle))" }}
      aria-hidden="true"
    />
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lgs" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#465fff" />
          <stop offset="1" stopColor="#a04dff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#lgs)" />
      <path d="M9 22V10h4l3 7 3-7h4v12h-3v-7l-2.6 6h-2.8L12 15v7z" fill="#fff" />
    </svg>
  );
}
