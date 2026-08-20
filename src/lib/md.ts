import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

export function renderMd(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

/** Blank out complete inline-code spans so the marks inside them don't count
 *  toward emphasis balance. Length is preserved so offsets stay meaningful. */
function maskInlineCode(s: string): string {
  return s.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

/** Everything OUTSIDE fenced code blocks. Code contents are verbatim — an
 *  asterisk in a code sample must never be treated as an unclosed bold. */
function outsideFences(src: string): { text: string; inFence: boolean } {
  const kept: string[] = [];
  let inFence = false;
  for (const line of src.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return { text: kept.join("\n"), inFence };
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** A table renders as a wall of raw pipes until its delimiter row arrives, so
 *  hold back a header that hasn't got one yet. */
function dropIncompleteTable(src: string): string {
  const lines = src.split("\n");
  let start = lines.length;
  while (start > 0 && /^\s*\|/.test(lines[start - 1])) start--;
  const block = lines.slice(start);
  if (!block.length) return src;
  // A delimiter row (|---|---|) on the second line means the table is parseable.
  const delimited = block.length >= 2 && /^\s*\|?[\s|:-]*-[\s|:-]*$/.test(block[1]);
  if (delimited) return src;
  return lines.slice(0, start).join("\n");
}

/** Make a PARTIAL markdown string safe to render mid-stream.
 *
 *  Half-typed markdown is valid markdown that means something else: `**Total`
 *  shows two literal asterisks until its closer arrives, then snaps to bold.
 *  Across an answer full of bold labels and code spans that reads as flicker.
 *  This closes what is still open so the text renders in its final form from
 *  the first character and simply grows.
 *
 *  Only ever used for the streaming preview. The finished message is parsed
 *  exactly as the model wrote it, so nothing here can alter stored output. */
export function stabilizeStreamMd(src: string): string {
  // Inside an unclosed fence marked already renders a code block, and the
  // contents are literal — leave the whole thing alone.
  if (outsideFences(src).inFence) return src;

  // Trailing fragments that would flash as raw punctuation. A complete `[1]`
  // citation is left alone: these patterns only match an unclosed bracket.
  let out = dropIncompleteTable(src);
  out = out.replace(/!?\[[^\]\n]*\]\([^)\n]*$/, "");
  out = out.replace(/!?\[[^\]\n]*$/, "");

  const masked = maskInlineCode(outsideFences(out).text);
  let close = "";
  if (count(masked, "`") % 2 === 1) close += "`";
  if ((masked.split("**").length - 1) % 2 === 1) close += "**";
  // Lone asterisks, ignoring bold pairs and `* ` bullet markers.
  const italic = masked.replace(/\*\*/g, "").replace(/^[ \t]*\*[ \t]/gm, "  ");
  if (count(italic, "*") % 2 === 1) close += "*";

  return out + close;
}

/** Render a partial reply. Same sanitization as `renderMd` — this only feeds it
 *  a stabilized copy of the source. */
export function renderStreamMd(src: string): string {
  return renderMd(stabilizeStreamMd(src));
}
