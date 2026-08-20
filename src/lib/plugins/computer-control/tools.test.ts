import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import type { ToolRunContext } from "../../tools";
import { prepareTextInsertionTool } from "./tools";

const { computerTarget } = vi.hoisted(() => ({ computerTarget: vi.fn() }));
vi.mock("../../native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native")>()),
  computerTarget,
}));

function context(): ToolRunContext {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      installedPlugins: ["computer-control"],
      plugins: { "computer-control": true },
    },
    consent: { web: false, screen: false, music: false },
    sources: [],
  };
}

beforeEach(() => computerTarget.mockReset());

describe("computer control text insertion", () => {
  it("is gated by plugin installation and enablement", () => {
    const ctx = context();
    expect(prepareTextInsertionTool.available(ctx.settings, ctx.consent)).toBe(true);
    expect(
      prepareTextInsertionTool.available(
        { ...ctx.settings, installedPlugins: [] },
        ctx.consent,
      ),
    ).toBe(false);
  });

  it("creates an approval card without inserting anything", async () => {
    computerTarget.mockResolvedValue({ id: "42", title: "Application form" });
    const out = await prepareTextInsertionTool.run(
      { text: "Dear hiring manager" },
      context(),
    );
    expect(out.card).toEqual({
      type: "computer_insert_text",
      data: {
        target: { id: "42", title: "Application form" },
        text: "Dear hiring manager",
      },
    });
    expect(out.content).toMatch(/NOT been inserted/);
  });

  it("rejects blank and oversized text before selecting a target", async () => {
    expect(
      (await prepareTextInsertionTool.run({ text: "  " }, context())).content,
    ).toMatch(/required/);
    expect(
      (await prepareTextInsertionTool.run({ text: "x".repeat(20_001) }, context()))
        .content,
    ).toMatch(/too long/);
    expect(computerTarget).not.toHaveBeenCalled();
  });
});
