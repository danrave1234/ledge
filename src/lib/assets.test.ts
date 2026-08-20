import { describe, expect, it } from "vitest";
import { conversationsForStorage } from "./assets";
import type { Conversation } from "./types";

describe("conversation assets", () => {
  it("omits inline base64 once an asset reference exists", () => {
    const conversations: Conversation[] = [
      {
        id: "c",
        title: "capture",
        createdAt: 1,
        updatedAt: 1,
        messages: [
          {
            id: "m",
            role: "user",
            content: "look",
            ts: 1,
            image: "data:image/png;base64,AAA",
            imageRef: "asset-1",
          },
        ],
      },
    ];
    const stored = conversationsForStorage(conversations);
    expect(stored[0].messages[0].imageRef).toBe("asset-1");
    expect(stored[0].messages[0].image).toBeUndefined();
    expect(conversations[0].messages[0].image).toContain("base64");
  });
});
