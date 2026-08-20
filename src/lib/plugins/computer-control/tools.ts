import { computerTarget } from "../../native";
import { pluginActive } from "../../plugins";
import type { PerchTool } from "../../tools";

const MAX_INSERT_LENGTH = 20_000;

function textArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const prepareTextInsertionTool: PerchTool = {
  pluginId: "computer-control",
  runningLabel: "Preparing text insertion",
  capability:
    "prepare text to insert into the field the user was most recently using, subject to their explicit approval",
  spec: {
    name: "prepare_text_insertion",
    description:
      "Prepare exact text for insertion into the field the user was using before opening Perch. This only creates an approval card; it does not insert or submit anything. Use after drafting the final text when the user asks to write, fill, or insert it into another app.",
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
          "No external target window is available. Ask the user to focus the destination field, then reopen Perch and try again.",
      };
    }
    return {
      content: `Prepared an insertion preview for “${target.title}”. The text has NOT been inserted; tell the user to review the card and press Insert or Cancel.`,
      card: { type: "computer_insert_text", data: { target, text } },
    };
  },
};

export const computerControlTools: PerchTool[] = [prepareTextInsertionTool];
