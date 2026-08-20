import { describe, it, expect, afterEach } from "vitest";
import { applyTheme, applyAccent, removeLegacyCustomCss } from "./theme";

const root = () => document.documentElement;
const read = (v: string) => root().style.getPropertyValue(v);

afterEach(() => {
  root().removeAttribute("data-theme");
  root().removeAttribute("style");
});

describe("applyTheme", () => {
  it("marks an explicit theme and clears it for system", () => {
    applyTheme("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");
    applyTheme("system");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });
});

describe("applyAccent", () => {
  it("uses dark on-color for a light accent so labels stay readable", () => {
    applyAccent("#e0a13a"); // amber
    expect(read("--accent-on")).toBe("#141210");
  });

  it("uses white on-color for a dark accent", () => {
    applyAccent("#7c5cff"); // violet
    expect(read("--accent-on")).toBe("#fff");
  });

  it("derives a distinct hover color so buttons still react", () => {
    applyAccent("#7c5cff");
    expect(read("--accent-strong")).not.toBe("");
    expect(read("--accent-strong")).not.toBe("#7c5cff");
  });

  it("expands 3-digit hex", () => {
    applyAccent("#fff");
    expect(read("--accent-weak")).toBe("rgba(255, 255, 255, 0.14)");
  });

  it("clears every override when reset to the theme default", () => {
    applyAccent("#7c5cff");
    applyAccent("");
    for (const v of [
      "--accent",
      "--accent-strong",
      "--accent-text",
      "--accent-weak",
      "--accent-on",
    ]) {
      expect(read(v)).toBe("");
    }
  });

  it("ignores a value that isn't a hex color", () => {
    applyAccent("url(javascript:alert(1))");
    expect(read("--accent")).toBe("");
  });

  it.each(["#12345", "#1234567", "#12", "#12345678"])(
    "rejects unsupported hex length %s",
    (bad) => {
      applyAccent(bad);
      expect(read("--accent")).toBe("");
    },
  );
});

describe("removeLegacyCustomCss", () => {
  it("removes a stylesheet left by the retired Custom CSS setting", () => {
    const el = document.createElement("style");
    el.id = "perch-custom-css";
    document.head.appendChild(el);
    removeLegacyCustomCss();
    expect(document.getElementById("perch-custom-css")).toBeNull();
  });

  it("is safe when there is nothing to remove", () => {
    expect(() => removeLegacyCustomCss()).not.toThrow();
  });
});
