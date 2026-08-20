import { describe, expect, it } from "vitest";
import type { Conversation } from "./types";
import {
  conversationToMarkdown,
  exportFilename,
  highlightParts,
  historyToJson,
  messageSnippet,
  searchConversations,
} from "./history";

const conversations: Conversation[] = [
  {
    id: "new",
    title: "Trip planning",
    createdAt: 1,
    updatedAt: 3,
    messages: [{ id: "m1", role: "user", content: "Find a quiet hotel", ts: 2 }],
  },
  {
    id: "old",
    title: "Recipes",
    createdAt: 4,
    updatedAt: 6,
    messages: [
      {
        id: "m2",
        role: "assistant",
        content: "Try tomato soup",
        image: "data:image/png;base64,secret",
        imageRef: "asset-1",
        cards: [{ type: "fixture", data: { raw: "data:application/pdf;base64,hidden" } }],
        ts: 5,
      },
    ],
  },
];

describe("history search", () => {
  it("matches titles and messages case-insensitively without changing order", () => {
    expect(
      searchConversations(conversations, "P").map((match) => match.conversation.id),
    ).toEqual(["new", "old"]);
    expect(searchConversations(conversations, "TOMATO")[0].snippet).toBe(
      "Try tomato soup",
    );
    expect(
      searchConversations(conversations, "").map((match) => match.conversation.id),
    ).toEqual(["new", "old"]);
  });

  it("builds bounded contextual snippets", () => {
    expect(
      messageSnippet(`before ${"x".repeat(100)} needle after`, "needle", 30),
    ).toMatch(/^….*needle.*$/);
  });

  it("splits highlighted text without HTML", () => {
    expect(highlightParts("Tomato tomato", "TOMATO")).toEqual([
      { text: "Tomato", match: true },
      { text: " ", match: false },
      { text: "tomato", match: true },
    ]);
  });
});

describe("history export", () => {
  it("creates readable Markdown", () => {
    const markdown = conversationToMarkdown(conversations[0]);
    expect(markdown).toContain("# Trip planning");
    expect(markdown).toContain("## User — 1970-01-01T00:00:00.002Z");
    expect(markdown).toContain("Find a quiet hotel");
  });

  it("creates versioned JSON without hydrated data URLs", () => {
    const json = historyToJson(conversations, 10);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe("1970-01-01T00:00:00.010Z");
    expect(parsed.conversations[1].messages[0].image).toBeUndefined();
    expect(parsed.conversations[1].messages[0].imageRef).toBe("asset-1");
    expect(json).not.toContain("base64,secret");
    expect(json).not.toContain("base64,hidden");
  });

  it("sanitizes suggested filenames", () => {
    expect(exportFilename("A: / chat", "md")).toBe("A- - chat.md");
  });
});
