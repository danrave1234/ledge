import { assetDelete, assetRead, assetStore } from "./native";
import type { Conversation, Msg } from "./types";
import { uid } from "./stores/persistence";

/** Move a data URL out of the conversation JSON into a bounded app-data asset. */
export async function persistImage(
  image?: string,
): Promise<{ image?: string; imageRef?: string }> {
  if (!image?.startsWith("data:image/")) return { image };
  const imageRef = uid();
  try {
    if (await assetStore(imageRef, image)) return { image, imageRef };
  } catch (e) {
    console.error("asset_store failed", e);
  }
  // Browser preview has no asset backend; retaining the data URL there is fine.
  return { image };
}

/** Resolve asset references after loading, migrating legacy inline images on
 * the way. Missing files degrade to no thumbnail without losing the message. */
export async function hydrateConversationAssets(
  conversations: Conversation[],
): Promise<Conversation[]> {
  return await Promise.all(
    conversations.map(async (conversation) => ({
      ...conversation,
      messages: await Promise.all(
        conversation.messages.map(async (message) => {
          if (message.imageRef) {
            const image = await assetRead(message.imageRef);
            return image ? { ...message, image } : { ...message, image: undefined };
          }
          if (message.image?.startsWith("data:image/")) {
            return { ...message, ...(await persistImage(message.image)) };
          }
          return message;
        }),
      ),
    })),
  );
}

/** Omit duplicated base64 from JSON once an asset reference exists. */
export function conversationsForStorage(conversations: Conversation[]): Conversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => {
      if (!message.imageRef) return message;
      const { image: _image, ...stored } = message;
      return stored;
    }),
  }));
}

export function deleteMessageAssets(messages: Msg[]): void {
  for (const message of messages) {
    if (message.imageRef) void assetDelete(message.imageRef);
  }
}
