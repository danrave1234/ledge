import { describe, it, expect } from "vitest";
import { cardComponent, renderableCards } from "./cards";

describe("card registry", () => {
  it("resolves a registered card type", () => {
    expect(cardComponent("now_playing")).toBeDefined();
  });

  it("returns nothing for a type this build does not know", () => {
    expect(cardComponent("from_a_future_plugin")).toBeUndefined();
  });

  it("drops cards it cannot draw", () => {
    // Cards persist with the conversation, so a build that dropped a plugin
    // WILL read cards it no longer has a renderer for. Those must disappear
    // quietly rather than render as a blank box or throw mid-message.
    const cards = [
      { type: "now_playing", data: {} },
      { type: "from_a_future_plugin", data: {} },
    ];
    expect(renderableCards(cards)).toEqual([{ type: "now_playing", data: {} }]);
  });

  it("handles a message with no cards at all", () => {
    expect(renderableCards(undefined)).toEqual([]);
    expect(renderableCards([])).toEqual([]);
  });

  it("survives malformed entries in stored data", () => {
    // The store is JSON on disk; a truncated write or a hand-edit can leave
    // junk in the array, and one bad entry must not take out the message.
    const junk = [null, undefined, { data: {} }] as never;
    expect(renderableCards(junk)).toEqual([]);
  });
});
