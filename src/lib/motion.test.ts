import { afterEach, describe, expect, it, vi } from "vitest";
import { panelIn, viewIn, stagger, popIn, reduceMotion } from "./motion";

function setReduced(reduced: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduced && q.includes("reduce"),
  }));
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia;
}

afterEach(() => vi.unstubAllGlobals());

describe("motion presets", () => {
  it("slide the panel out of the edge it is docked to", () => {
    setReduced(false);
    expect(panelIn("top")).toMatchObject({ x: 0, y: -10 });
    expect(panelIn("left")).toMatchObject({ x: -10, y: 0 });
    expect(panelIn("right")).toMatchObject({ x: 10, y: 0 });
    expect(viewIn(-1).x).toBeLessThan(0);
    expect(stagger(20).delay).toBe(stagger(8).delay); // capped
  });

  it("drop movement and duration under reduced motion", () => {
    setReduced(true);
    expect(reduceMotion()).toBe(true);
    expect(panelIn("left")).toMatchObject({ x: 0, y: 0, duration: 1 });
    expect(viewIn(1)).toMatchObject({ x: 0, duration: 1 });
    expect(stagger(5)).toMatchObject({ delay: 0, y: 0 });
    expect(popIn().start).toBe(1);
  });
});
