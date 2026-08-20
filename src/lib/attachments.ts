import type { Attachment, Msg } from "./types";

export const DOCUMENT_EXTENSIONS = ["txt", "md", "json", "csv", "pdf"] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export function isSupportedAttachment(
  file: Pick<File, "name" | "type" | "size">,
): string | null {
  if (file.type.startsWith("image/")) return null;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!DOCUMENT_EXTENSIONS.includes(extension as (typeof DOCUMENT_EXTENSIONS)[number])) {
    return "Unsupported file type. Attach an image, .txt, .md, .json, .csv, or .pdf file.";
  }
  if (file.size > MAX_DOCUMENT_BYTES) return "Document is too large (5 MB maximum).";
  return null;
}

export function attachmentText(attachment?: Attachment): string {
  if (attachment?.kind !== "document" || !attachment.text) return "";
  return `\n\n--- Attached document: ${attachment.name} ---\n${attachment.text}\n--- End attached document ---`;
}

export function messageContent(message: Pick<Msg, "content" | "attachment">): string {
  return message.content + attachmentText(message.attachment);
}

export function canSend(text: string, attachment?: Attachment | null): boolean {
  return !!text.trim() || !!attachment;
}
