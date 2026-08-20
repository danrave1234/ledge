import { describe, it, expect } from "vitest";
import { selectMemories, tokenize } from "./memory";
import type { Memory } from "./types";

let n = 0;
const mem = (text: string, enabled = true): Memory => ({
  id: `m${n++}`,
  text,
  enabled,
});

const many = (): Memory[] => [
  mem("Prefers TypeScript over JavaScript"),
  mem("Lives in Cebu, Philippines"),
  mem("Is allergic to shellfish"),
  mem("Drives a 2015 Honda Civic"),
  mem("Works on a Windows desktop widget called Perch"),
  mem("Plays Dota 2 most evenings"),
  mem("Favourite coffee is a flat white"),
  mem("Has a golden retriever named Biscuit"),
  mem("Uses Svelte for frontend work"),
  mem("Studying for a certification exam"),
];

const texts = (m: Memory[]) => m.map((x) => x.text);

describe("tokenize", () => {
  it("drops stopwords and short words", () => {
    expect(tokenize("what is the best way to do this")).toEqual(["best", "way"]);
  });

  it("keeps technical tokens intact", () => {
    expect(tokenize("Uses C# and .NET with node.js")).toContain("c#");
    expect(tokenize("Uses C# and .NET with node.js")).toContain("node.js");
  });

  it("matches singular and plural forms", () => {
    expect(tokenize("widgets")).toEqual(tokenize("widget"));
  });
});

describe("selectMemories", () => {
  it("sends everything when the list is short", () => {
    const few = [mem("a fact"), mem("another fact")];
    expect(selectMemories(few, "unrelated question")).toHaveLength(2);
  });

  it("skips disabled memories", () => {
    const list = [mem("kept"), mem("ignored", false)];
    expect(texts(selectMemories(list, "anything"))).toEqual(["kept"]);
  });

  it("picks the memories that relate to the question", () => {
    const picked = texts(
      selectMemories(many(), "what should I cook, any allergies?", { max: 3 }),
    );
    expect(picked).toContain("Is allergic to shellfish");
  });

  it("uses conversation context when the question alone has no keywords", () => {
    const picked = texts(
      selectMemories(many(), "and that one?", {
        max: 3,
        context: "we were talking about your dog",
      }),
    );
    expect(picked).toContain("Has a golden retriever named Biscuit");
  });

  it("never exceeds the cap", () => {
    expect(
      selectMemories(many(), "typescript svelte windows dota coffee", { max: 4 }),
    ).toHaveLength(4);
  });

  it("still sends background when nothing matches", () => {
    const picked = selectMemories(many(), "zzzz qqqq", { max: 3 });
    expect(picked).toHaveLength(3);
  });

  it("returns memories in their original order", () => {
    const list = many();
    const picked = selectMemories(list, "typescript and svelte work", { max: 4 });
    const order = picked.map((p) => list.findIndex((l) => l.id === p.id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("prefers a question hit over a context-only hit", () => {
    const list = many();
    const picked = texts(
      selectMemories(list, "which car do I drive?", { max: 2, context: "coffee" }),
    );
    expect(picked).toContain("Drives a 2015 Honda Civic");
  });

  it("handles an empty list", () => {
    expect(selectMemories([], "anything")).toEqual([]);
  });
});
