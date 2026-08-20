import { describe, it, expect } from "vitest";
import { renderMd, renderStreamMd, stabilizeStreamMd } from "./md";

/** Model output is untrusted HTML by the time it reaches the DOM: it is
    rendered with {@html}, so sanitization here is the only thing between a
    prompt-injected payload and script execution inside the widget. */
describe("renderMd", () => {
  it("renders basic markdown", () => {
    expect(renderMd("**bold**")).toContain("<strong>bold</strong>");
    expect(renderMd("- a\n- b")).toContain("<li>");
  });

  it("keeps fenced code blocks with their language class", () => {
    const html = renderMd("```ts\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("language-ts");
  });

  it("strips script tags", () => {
    expect(renderMd("<script>alert(1)</script>")).not.toContain("<script");
  });

  it("strips inline event handlers", () => {
    expect(renderMd('<img src="x" onerror="alert(1)">')).not.toContain("onerror");
  });

  it("drops javascript: URLs but keeps normal links", () => {
    expect(renderMd("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(renderMd("[x](https://example.com)")).toContain("https://example.com");
  });

  it("escapes text that only looks like markup", () => {
    expect(renderMd("a < b && c > d")).not.toContain("<b");
  });

  it("handles empty input", () => {
    expect(renderMd("")).toBe("");
  });
});

/** Mid-stream the source is half-typed markdown. Rendering it raw makes every
    bold label and code span flash as literal punctuation before snapping into
    place; stabilizing closes what is still open so text renders in its final
    form and simply grows. */
describe("stabilizeStreamMd", () => {
  it("closes a half-typed bold run", () => {
    expect(renderStreamMd("Total: **12")).toContain("<strong>12</strong>");
    expect(renderStreamMd("Total: **12")).not.toContain("**");
  });

  it("leaves a finished bold run alone", () => {
    expect(stabilizeStreamMd("**done** and more")).toBe("**done** and more");
  });

  it("closes a half-typed code span", () => {
    expect(renderStreamMd("Run `npm inst")).toContain("<code>npm inst</code>");
  });

  it("closes a half-typed italic run without eating list bullets", () => {
    expect(renderStreamMd("An *emph")).toContain("<em>emph</em>");
    // `* item` is a bullet marker, not an unclosed emphasis.
    expect(stabilizeStreamMd("* one\n* two")).toBe("* one\n* two");
  });

  it("hides a link until its target is complete", () => {
    expect(stabilizeStreamMd("See [the docs](https://exa")).toBe("See ");
    expect(stabilizeStreamMd("See [the do")).toBe("See ");
  });

  it("keeps a completed citation marker", () => {
    // `[1]` is a finished bracket the citation UI depends on — it must survive.
    expect(stabilizeStreamMd("Confirmed [1]")).toBe("Confirmed [1]");
  });

  it("holds back a table until its delimiter row arrives", () => {
    expect(stabilizeStreamMd("Here:\n| Name | Age |")).toBe("Here:");
    const withDelim = "Here:\n| Name | Age |\n| --- | --- |";
    expect(stabilizeStreamMd(withDelim)).toBe(withDelim);
  });

  it("never touches the inside of a code block", () => {
    // Asterisks and backticks in a code sample are literal text, and marked
    // already closes the fence itself.
    const partial = "```ts\nconst a = b ** 2;\nconst s = `x";
    expect(stabilizeStreamMd(partial)).toBe(partial);
  });

  it("ignores emphasis marks inside a finished code span", () => {
    expect(stabilizeStreamMd("Use `a ** b` here")).toBe("Use `a ** b` here");
  });

  it("still sanitizes while streaming", () => {
    expect(renderStreamMd("<script>alert(1)</script>")).not.toContain("<script");
  });

  it("passes plain prose through untouched", () => {
    expect(stabilizeStreamMd("Just a sentence.")).toBe("Just a sentence.");
    expect(stabilizeStreamMd("")).toBe("");
  });
});
