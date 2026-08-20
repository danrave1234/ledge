import { describe, expect, it } from "vitest";
import { canSend, isSupportedAttachment, messageContent } from "./attachments";
import type { Attachment } from "./types";

const document: Attachment = {
  kind: "document",
  name: "notes.md",
  mime: "text/markdown",
  size: 12,
  text: "same text for every provider",
};

describe("attachments", () => {
  it("adds bounded extracted text to provider content with a filename label", () => {
    const content = messageContent({ content: "Summarize this", attachment: document });
    expect(content).toContain("Attached document: notes.md");
    expect(content).toContain("same text for every provider");
    expect(content).not.toContain("data:");
  });

  it("allows an attachment-only send", () => {
    expect(canSend("", document)).toBe(true);
    expect(canSend("  ", null)).toBe(false);
  });

  it("rejects unsupported and oversized documents but accepts images and supported files", () => {
    expect(isSupportedAttachment({ name: "notes.docx", type: "", size: 2 })).toMatch(
      /Unsupported/,
    );
    expect(
      isSupportedAttachment({
        name: "large.pdf",
        type: "application/pdf",
        size: 5 * 1024 * 1024 + 1,
      }),
    ).toMatch(/5 MB/);
    expect(
      isSupportedAttachment({ name: "photo.png", type: "image/png", size: 9 }),
    ).toBeNull();
    expect(isSupportedAttachment({ name: "data.CSV", type: "", size: 9 })).toBeNull();
  });
});
