import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const deleteMessageAssets = vi.fn();
vi.mock("../assets", () => ({
  deleteMessageAssets: (...a: unknown[]) => deleteMessageAssets(...a),
}));

const {
  conversations,
  messages,
  activeId,
  removeConversation,
  restoreConversation,
  purgeConversationAssets,
  resolveCard,
  truncateFrom,
  openConversation,
} = await import("./conversations");
import type { Conversation, Msg } from "../types";

const msg = (id: string, role: Msg["role"], extra: Partial<Msg> = {}): Msg => ({
  id,
  role,
  content: id,
  ts: 1,
  ...extra,
});
const conv = (id: string, updatedAt: number, msgs: Msg[] = [msg(`${id}-m`, "user")]) =>
  ({ id, title: id, createdAt: 1, updatedAt, messages: msgs }) as Conversation;

beforeEach(() => {
  deleteMessageAssets.mockReset();
  conversations.set([conv("new", 3), conv("mid", 2), conv("old", 1)]);
  messages.set([]);
  activeId.set(null);
});

describe("undoable conversation delete", () => {
  it("removes without touching stored images until committed", () => {
    const removed = removeConversation("mid");
    expect(get(conversations).map((c) => c.id)).toEqual(["new", "old"]);
    expect(deleteMessageAssets).not.toHaveBeenCalled();
    purgeConversationAssets(removed!);
    expect(deleteMessageAssets).toHaveBeenCalledWith(removed!.messages);
  });

  it("restores into its sorted place, once", () => {
    const removed = removeConversation("mid")!;
    restoreConversation(removed);
    restoreConversation(removed);
    expect(get(conversations).map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("clears the open chat when the open conversation is removed", () => {
    openConversation("new");
    removeConversation("new");
    expect(get(activeId)).toBeNull();
    expect(get(messages)).toEqual([]);
  });
});

describe("approval card resolution", () => {
  it("persists how a card was resolved onto the conversation", () => {
    const card = { type: "app_launch", data: { app: { name: "Spotify" } } };
    conversations.set([
      conv("c", 1, [msg("u", "user"), msg("a", "assistant", { cards: [card] })]),
    ]);
    openConversation("c");
    resolveCard("a", 0, { status: "opened", label: "Spotify" });
    const stored = get(conversations)[0].messages[1].cards![0];
    expect(stored.resolved).toEqual({ status: "opened", label: "Spotify" });
    expect(stored.data).toEqual(card.data);
  });

  it("ignores an unknown message or card index", () => {
    conversations.set([conv("c", 1, [msg("a", "assistant")])]);
    openConversation("c");
    resolveCard("missing", 0, { status: "opened" });
    resolveCard("a", 3, { status: "opened" });
    expect(get(messages)[0].cards).toBeUndefined();
  });
});

describe("truncateFrom", () => {
  it("drops the message and everything after it", () => {
    conversations.set([
      conv("c", 1, [
        msg("u1", "user"),
        msg("a1", "assistant"),
        msg("u2", "user"),
        msg("a2", "assistant"),
      ]),
    ]);
    openConversation("c");
    truncateFrom("u2");
    expect(get(messages).map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(get(conversations)[0].messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });
});
