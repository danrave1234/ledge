import { computerTarget } from "../../native";
import { pluginActive } from "../../plugins";
import type { LedgeTool } from "../../tools";

const MAX_INSERT_LENGTH = 20_000;
const MAX_URL_LENGTH = 2_048;
const MAX_ACTIONS = 12;
const ALLOWED_KEYS = new Set([
  "backspace",
  "delete",
  "down",
  "end",
  "enter",
  "escape",
  "home",
  "left",
  "page_down",
  "page_up",
  "right",
  "space",
  "tab",
  "up",
]);

export type ComputerAction =
  | { kind: "click" | "double_click" | "right_click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; amount: number };

function textArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const prepareTextInsertionTool: LedgeTool = {
  pluginId: "computer-control",
  runningLabel: "Preparing text insertion",
  capability:
    "prepare text to insert into the field the user was most recently using, subject to their explicit approval",
  spec: {
    name: "prepare_text_insertion",
    description:
      "Prepare exact text for insertion into the field the user was using before opening Ledge. This only creates an approval card; it does not insert or submit anything. Use after drafting the final text when the user asks to write, fill, or insert it into another app.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The complete exact text to preview for insertion.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  available: (s) => pluginActive(s, "computer-control"),
  async run(args) {
    const text = textArg(args.text);
    if (!text.trim())
      return { content: "Error: `text` is required and cannot be blank." };
    if (text.length > MAX_INSERT_LENGTH) {
      return {
        content: `Error: text is too long to insert safely (maximum ${MAX_INSERT_LENGTH} characters).`,
      };
    }
    const target = await computerTarget();
    if (!target) {
      return {
        content:
          "No external target window is available. Ask the user to focus the destination field, then reopen Ledge and try again.",
      };
    }
    return {
      content: `Prepared an insertion preview for “${target.title}”. The text has NOT been inserted; tell the user to review the card and press Insert or Cancel.`,
      card: { type: "computer_insert_text", data: { target, text } },
    };
  },
};

function normalizedUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > MAX_URL_LENGTH) return null;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Recognize only explicit navigation requests for providers that cannot use
 * Ledge's tool-call protocol. Keeping this narrow avoids turning an ordinary
 * mention of a URL into a computer action. */
export function browserNavigationUrl(text: string): string | null {
  if (!/\b(?:change|navigate|open|go|take)\b/i.test(text)) return null;
  if (!/\b(?:browser|url|website|site|page|tab)\b/i.test(text)) return null;
  const match = text.match(
    /(?:https?:\/\/)?(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}(?:[/:?#][^\s]*)?/i,
  );
  return match ? normalizedUrl(match[0]) : null;
}

export const prepareBrowserNavigationTool: LedgeTool = {
  pluginId: "computer-control",
  runningLabel: "Preparing browser navigation",
  capability:
    "prepare navigation of the user's previously focused browser to a web address, subject to their explicit approval",
  spec: {
    name: "prepare_browser_navigation",
    description:
      "Prepare a web address to open in the browser window the user was using before opening Ledge. This only creates an approval card. Use when the user asks to change, open, or navigate the current browser to a URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The complete HTTP or HTTPS web address to preview.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  available: (s) => pluginActive(s, "computer-control"),
  async run(args) {
    const url = normalizedUrl(args.url);
    if (!url) return { content: "Error: a valid HTTP or HTTPS web address is required." };
    const target = await computerTarget();
    if (!target) {
      return {
        content:
          "No browser target is available. Ask the user to focus their browser, then reopen Ledge and try again.",
      };
    }
    return {
      content: `Prepared a browser navigation preview for “${target.title}”. Navigation has NOT happened; tell the user to review the card and press Open or Cancel.`,
      card: { type: "computer_navigate_browser", data: { target, url } },
    };
  },
};

function validActions(value: unknown): ComputerAction[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ACTIONS)
    return null;
  const actions: ComputerAction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const action = raw as Record<string, unknown>;
    if (["click", "double_click", "right_click"].includes(String(action.kind))) {
      if (
        !Number.isInteger(action.x) ||
        !Number.isInteger(action.y) ||
        Number(action.x) < 0 ||
        Number(action.x) > 1000 ||
        Number(action.y) < 0 ||
        Number(action.y) > 1000
      )
        return null;
      actions.push({
        kind: action.kind as "click" | "double_click" | "right_click",
        x: Number(action.x),
        y: Number(action.y),
      });
    } else if (action.kind === "type") {
      if (
        typeof action.text !== "string" ||
        !action.text.length ||
        action.text.length > MAX_INSERT_LENGTH
      )
        return null;
      actions.push({ kind: "type", text: action.text });
    } else if (action.kind === "key") {
      if (typeof action.key !== "string" || !ALLOWED_KEYS.has(action.key)) return null;
      actions.push({ kind: "key", key: action.key });
    } else if (action.kind === "scroll") {
      if (
        !Number.isInteger(action.amount) ||
        Number(action.amount) === 0 ||
        Math.abs(Number(action.amount)) > 2400
      )
        return null;
      actions.push({ kind: "scroll", amount: Number(action.amount) });
    } else return null;
  }
  return actions;
}

export const prepareComputerActionsTool: LedgeTool = {
  pluginId: "computer-control",
  runningLabel: "Preparing computer actions",
  capability:
    "prepare a bounded sequence of visible clicks, typing, navigation keys, and scrolling in the previously focused window, subject to explicit approval",
  spec: {
    name: "prepare_computer_actions",
    description:
      "Prepare up to 12 actions in the previously focused window. This creates one approval card and does not run anything. Click coordinates are integers from 0 to 1000 relative to the target window's left/top and right/bottom edges. Use a reviewed screen image to estimate targets. Prefer one short, verifiable plan; never include sending, submitting, purchasing, deleting, authentication, or password entry.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "A short, specific explanation of the visible result to approve.",
        },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ACTIONS,
          description:
            "Actions: click/double_click/right_click with normalized x,y; type with text; key with tab, enter, escape, arrows, home/end, page_up/page_down, space, backspace, or delete; scroll with amount from -2400 to 2400.",
          items: { type: "object" },
        },
      },
      required: ["summary", "actions"],
      additionalProperties: false,
    },
  },
  available: (s) => pluginActive(s, "computer-control"),
  async run(args) {
    const summary = textArg(args.summary).trim();
    const actions = validActions(args.actions);
    if (!summary || summary.length > 240 || !actions) {
      return {
        content: "Error: a short summary and 1–12 valid, safe actions are required.",
      };
    }
    const target = await computerTarget();
    if (!target) {
      return {
        content:
          "No external target window is available. Ask the user to focus it, then reopen Ledge and try again.",
      };
    }
    return {
      content: `Prepared ${actions.length} computer action${actions.length === 1 ? "" : "s"} for “${target.title}”. They have NOT run; tell the user to review the card and press Run or Cancel.`,
      card: { type: "computer_actions", data: { target, summary, actions } },
    };
  },
};

export const computerControlTools: LedgeTool[] = [
  prepareTextInsertionTool,
  prepareBrowserNavigationTool,
  prepareComputerActionsTool,
];
