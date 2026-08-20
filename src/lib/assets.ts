import { assetDelete, assetRead, assetStore } from "./native";
import type { Attachment, Conversation, Msg } from "./types";
import { uid } from "./stores/persistence";

/** Move a data URL out of the conversation JSON into a bounded app-data asset. */
export async function persistImage(
  image?: string,
): Promise<{ image?: string; imageRef?: string }> {
  if (!image?.startsWith("data:image/")) return { image };
  const imageRef = uid();
  try {
    if (await assetStore(imageRef, "image", image)) return { image, imageRef };
  } catch (e) {
    console.error("asset_store failed", e);
  }
  // Browser preview has no asset backend; retaining the data URL there is fine.
  return { image };
}

export async function persistAttachment(attachment: Attachment): Promise<Attachment> {
  const content = attachment.kind === "image" ? attachment.data : attachment.text;
  if (!content || attachment.assetRef) return attachment;
  const assetRef = uid();
  try {
    if (await assetStore(assetRef, attachment.kind, content)) {
      return { ...attachment, assetRef };
    }
  } catch (e) {
    console.error("asset_store failed", e);
  }
  return attachment;
}

function legacyAttachment(message: Msg): Attachment | undefined {
  if (!message.image && !message.imageRef) return undefined;
  const mime = message.image?.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
  return {
    kind: "image",
    mime,
    size: message.image?.length ?? 0,
    data: message.image,
    assetRef: message.imageRef,
  };
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
          let attachment = message.attachment ?? legacyAttachment(message);
          if (!attachment) return message;
          if (attachment.assetRef) {
            const stored = await assetRead(attachment.assetRef);
            if (stored?.kind === attachment.kind) {
              attachment =
                attachment.kind === "image"
                  ? { ...attachment, data: stored.content }
                  : { ...attachment, text: stored.content };
            }
          } else {
            attachment = await persistAttachment(attachment);
          }
          const { image: _image, imageRef: _imageRef, ...migrated } = message;
          return { ...migrated, attachment };
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
      const attachment = message.attachment ?? legacyAttachment(message);
      const { image: _image, imageRef: _imageRef, ...stored } = message;
      if (!attachment) return stored;
      const safe = { ...attachment };
      if (safe.assetRef) {
        if (safe.kind === "image") delete safe.data;
        else delete safe.text;
      }
      return { ...stored, attachment: safe };
    }),
  }));
}

export function deleteMessageAssets(messages: Msg[]): void {
  for (const message of messages) {
    const ref = message.attachment?.assetRef ?? message.imageRef;
    if (ref) void assetDelete(ref);
  }
}
