import { describe, expect, it } from "vitest";
import { conversationsForStorage, hydrateConversationAssets } from "./assets";
import type { Conversation } from "./types";

describe("conversation assets", () => {
  it("hydrates legacy inline images and image references into typed attachments", async () => {
    const conversations: Conversation[] = [
      {
        id: "c",
        title: "legacy images",
        createdAt: 1,
        updatedAt: 1,
        messages: [
          {
            id: "inline",
            role: "user",
            content: "inline",
            ts: 1,
            image: "data:image/jpeg;base64,AAA",
          },
          {
            id: "stored",
            role: "assistant",
            content: "stored",
            ts: 2,
            imageRef: "asset-1",
          },
        ],
      },
    ];

    const hydrated = await hydrateConversationAssets(conversations);
    const [inline, stored] = hydrated[0].messages;

    expect(inline.attachment).toMatchObject({
      kind: "image",
      mime: "image/jpeg",
      data: "data:image/jpeg;base64,AAA",
    });
    expect(inline.image).toBeUndefined();
    expect(inline.imageRef).toBeUndefined();
    expect(stored.attachment).toMatchObject({
      kind: "image",
      assetRef: "asset-1",
    });
    expect(stored.image).toBeUndefined();
    expect(stored.imageRef).toBeUndefined();
  });

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
    expect(stored[0].messages[0].attachment).toMatchObject({
      kind: "image",
      assetRef: "asset-1",
    });
    expect(stored[0].messages[0].image).toBeUndefined();
    expect(conversations[0].messages[0].image).toContain("base64");
  });

  it("omits hydrated typed content but retains document metadata", () => {
    const conversations: Conversation[] = [
      {
        id: "c",
        title: "document",
        createdAt: 1,
        updatedAt: 1,
        messages: [
          {
            id: "m",
            role: "user",
            content: "review",
            ts: 1,
            attachment: {
              kind: "document",
              name: "notes.txt",
              mime: "text/plain",
              size: 12,
              text: "private text",
              assetRef: "asset-2",
            },
          },
        ],
      },
    ];
    expect(conversationsForStorage(conversations)[0].messages[0].attachment).toEqual({
      kind: "document",
      name: "notes.txt",
      mime: "text/plain",
      size: 12,
      assetRef: "asset-2",
    });
  });
});
