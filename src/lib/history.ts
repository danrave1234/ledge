import type { Conversation, Msg } from "./types";

export const HISTORY_EXPORT_VERSION = 1;

export interface HistoryMatch {
  conversation: Conversation;
  snippet?: string;
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function highlightParts(value: string, query: string): HighlightPart[] {
  const needle = normalize(query);
  if (!needle) return [{ text: value, match: false }];
  const parts: HighlightPart[] = [];
  const lower = value.toLocaleLowerCase();
  let start = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    if (index > start) parts.push({ text: value.slice(start, index), match: false });
    parts.push({ text: value.slice(index, index + needle.length), match: true });
    start = index + needle.length;
    index = lower.indexOf(needle, start);
  }
  if (start < value.length) parts.push({ text: value.slice(start), match: false });
  return parts.length ? parts : [{ text: value, match: false }];
}

export function messageSnippet(
  content: string,
  query: string,
  length = 120,
): string | undefined {
  const needle = normalize(query);
  if (!needle) return undefined;
  const index = content.toLocaleLowerCase().indexOf(needle);
  if (index < 0) return undefined;

  const start = Math.max(0, index - Math.floor((length - needle.length) / 2));
  const end = Math.min(content.length, start + length);
  const text = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${text}${end < content.length ? "…" : ""}`;
}

/** Filter without sorting so the bounded store remains the source of ordering. */
export function searchConversations(
  conversations: Conversation[],
  query: string,
): HistoryMatch[] {
  const needle = normalize(query);
  if (!needle) return conversations.map((conversation) => ({ conversation }));

  return conversations.flatMap((conversation) => {
    const titleMatches = conversation.title.toLocaleLowerCase().includes(needle);
    const snippet = conversation.messages
      .map((message) => messageSnippet(message.content, query))
      .find((value) => value !== undefined);
    return titleMatches || snippet ? [{ conversation, snippet }] : [];
  });
}

function markdownMessage(message: Msg): string {
  const role = message.role[0].toUpperCase() + message.role.slice(1);
  const timestamp = new Date(message.ts).toISOString();
  const image =
    message.attachment?.kind === "image" || message.imageRef || message.image
      ? "\n\n_Attachment: image_"
      : message.attachment?.kind === "document"
        ? `\n\n_Attachment: ${message.attachment.name}_`
        : "";
  return `## ${role} — ${timestamp}\n\n${message.content}${image}`;
}

export function conversationToMarkdown(conversation: Conversation): string {
  return `# ${conversation.title}\n\nCreated: ${new Date(conversation.createdAt).toISOString()}\nUpdated: ${new Date(conversation.updatedAt).toISOString()}\n\n${conversation.messages.map(markdownMessage).join("\n\n")}\n`;
}

function privateMessage(message: Msg): Msg {
  const { image: _image, ...safe } = message;
  if (safe.attachment?.kind === "image") {
    const { data: _data, ...attachment } = safe.attachment;
    return { ...safe, attachment };
  }
  return safe;
}

export function historyToJson(
  conversations: Conversation[],
  exportedAt = Date.now(),
): string {
  return JSON.stringify(
    {
      schemaVersion: HISTORY_EXPORT_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
      conversations: conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map(privateMessage),
      })),
    },
    (key, value) => {
      if (key === "image") return undefined;
      if (typeof value === "string" && /^data:[^,]*;base64,/i.test(value))
        return undefined;
      return value;
    },
    2,
  );
}

export function exportFilename(title: string, extension: "md" | "json"): string {
  const safe = [...title.trim()]
    .map((character) =>
      '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? "-" : character,
    )
    .join("")
    .slice(0, 80);
  return `${safe || "conversation"}.${extension}`;
}
