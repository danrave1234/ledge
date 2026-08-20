import { writable, get } from "svelte/store";
import type { Msg, Conversation } from "../types";
import { truncate } from "../format";
import { uid } from "./persistence";
import { deleteMessageAssets } from "../assets";

/** Longest fallback title generated from the first user message. */
const TITLE_MAX = 48;

export const conversations = writable<Conversation[]>([]);
export const messages = writable<Msg[]>([]);
export const activeId = writable<string | null>(null);

export function newChat() {
  messages.set([]);
  activeId.set(null);
}

export function saveActive() {
  const msgs = get(messages);
  if (msgs.length === 0) return;
  const id = get(activeId) ?? uid();
  activeId.set(id);
  const firstUser = msgs.find((m) => m.role === "user");
  const title = truncate(firstUser?.content || "New chat", TITLE_MAX);
  const now = Date.now();
  conversations.update((list) => {
    const existing = list.find((c) => c.id === id);
    if (existing) {
      return list.map((c) =>
        c.id === id
          ? { ...c, messages: msgs, title: c.titled ? c.title : title, updatedAt: now }
          : c,
      );
    }
    return [
      { id, title, titled: false, messages: msgs, createdAt: now, updatedAt: now },
      ...list,
    ];
  });
}

/** Store the compaction notes and how far they cover. */
export function setConversationSummary(
  id: string,
  summary: string,
  summarizedThrough: string,
) {
  conversations.update((list) =>
    list.map((c) => (c.id === id ? { ...c, summary, summarizedThrough } : c)),
  );
}

/** Notes for the active conversation, if it has been compacted. */
export function activeSummary(): { summary?: string; summarizedThrough?: string } {
  const id = get(activeId);
  const conv = id ? get(conversations).find((c) => c.id === id) : undefined;
  return { summary: conv?.summary, summarizedThrough: conv?.summarizedThrough };
}

export function setConversationTitle(id: string, title: string) {
  conversations.update((list) =>
    list.map((c) => (c.id === id ? { ...c, title, titled: true } : c)),
  );
}

export function openConversation(id: string) {
  const conv = get(conversations).find((c) => c.id === id);
  if (!conv) return;
  messages.set([...conv.messages]);
  activeId.set(id);
}

export function deleteConversation(id: string) {
  conversations.update((list) => {
    const removed = list.find((c) => c.id === id);
    if (removed) deleteMessageAssets(removed.messages);
    return list.filter((c) => c.id !== id);
  });
  if (get(activeId) === id) newChat();
}

export function clearHistory() {
  conversations.update((list) => {
    for (const conversation of list) deleteMessageAssets(conversation.messages);
    return [];
  });
  newChat();
}
