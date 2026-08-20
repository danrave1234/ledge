import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import { prepareComputerControlFallback } from "./fallback";

const { computerTarget } = vi.hoisted(() => ({ computerTarget: vi.fn() }));
vi.mock("../../native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native")>()),
  computerTarget,
}));

const settings = {
  ...DEFAULT_SETTINGS,
  installedPlugins: ["computer-control"],
  plugins: { "computer-control": true },
};
const consent = { web: false, screen: false, music: false };

beforeEach(() => computerTarget.mockReset());

describe("computer control fallback", () => {
  it("uses the normal approval flow for explicit browser navigation", async () => {
    computerTarget.mockResolvedValue({ id: "7", title: "New tab - Google Chrome" });

    const outcome = await prepareComputerControlFallback(
      "open example.com in my browser",
      settings,
      consent,
    );

    expect(outcome?.card).toEqual({
      type: "computer_navigate_browser",
      data: {
        target: { id: "7", title: "New tab - Google Chrome" },
        url: "https://example.com/",
      },
    });
  });

  it("ignores ambiguous requests and disabled computer control", async () => {
    await expect(
      prepareComputerControlFallback("What is example.com?", settings, consent),
    ).resolves.toBeNull();
    await expect(
      prepareComputerControlFallback(
        "open example.com in my browser",
        { ...settings, plugins: { "computer-control": false } },
        consent,
      ),
    ).resolves.toBeNull();
    expect(computerTarget).not.toHaveBeenCalled();
  });
});
