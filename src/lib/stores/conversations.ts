import { writable, get } from "svelte/store";
import type { Msg, Conversation } from "../types";
import { uid } from "./persistence";

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
  const title = (firstUser?.content ?? "New chat").slice(0, 48);
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
  conversations.update((list) => list.filter((c) => c.id !== id));
  if (get(activeId) === id) newChat();
}

export function clearHistory() {
  conversations.set([]);
  newChat();
}
