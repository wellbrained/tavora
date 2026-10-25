import { describe, expect, it } from "vitest";
import type { ReadmeBlock } from "./host-api";
import { missingSections, sortReadme } from "./readme-sections";

const h = (text: string, level: 1 | 2 | 3 = 2): ReadmeBlock => ({ kind: "heading", level, text });
const p = (text: string): ReadmeBlock => ({ kind: "paragraph", spans: [{ text }] });

describe("sortReadme", () => {
  it("shows known sections in the fixed order, whatever order they were written in", () => {
    const sorted = sortReadme([h("Tracker", 1), p("Intro"), h("Known issues"), p("c"), h("Features"), p("a"), h("How to use"), p("b"), h("Requirements"), p("r"), h("Settings"), p("s")]);
    expect(sorted.known.map((section) => section.id)).toEqual(["overview", "features", "usage", "settings", "requirements", "issues"]);
    expect(sorted.known[0]!.blocks).toEqual([p("Intro")]);
    expect(sorted.more).toEqual([]);
  });

  it("knows the headings case-insensitively and in German", () => {
    const sorted = sortReadme([h("FUNKTIONEN"), p("a"), h("Bedienung"), p("b"), h("einstellungen:"), p("c"), h("Voraussetzungen"), p("d"), h("Bekannte Probleme"), p("e")]);
    expect(sorted.known.map((section) => section.id)).toEqual(["features", "usage", "settings", "requirements", "issues"]);
  });

  it("puts other headings under More, in the order written, and keeps sub-headings inside", () => {
    const sorted = sortReadme([p("Intro"), h("Credits"), p("x"), h("Features"), h("Detail", 3), p("y"), h("Changelog"), p("z")]);
    expect(sorted.more).toEqual([
      { title: "Credits", blocks: [p("x")] },
      { title: "Changelog", blocks: [p("z")] },
    ]);
    expect(sorted.known[1]!.blocks).toEqual([h("Detail", 3), p("y")]);
  });

  it("joins a known heading written twice and drops empty sections", () => {
    const sorted = sortReadme([h("Features"), p("a"), h("Settings"), h("Features"), p("b")]);
    expect(sorted.known).toEqual([{ id: "features", blocks: [p("a"), p("b")] }]);
  });

  it("shows a readme without the template as Overview and More", () => {
    expect(sortReadme([p("Just text"), { kind: "code", text: "x" }]).known).toEqual([{ id: "overview", blocks: [p("Just text"), { kind: "code", text: "x" }] }]);
    expect(sortReadme([h("Notes"), p("n")])).toEqual({ known: [], more: [{ title: "Notes", blocks: [p("n")] }] });
    expect(sortReadme([])).toEqual({ known: [], more: [] });
  });
});

describe("missingSections", () => {
  it("names Overview and Features when they are missing", () => {
    expect(missingSections([h("Settings"), p("s")])).toEqual(["overview", "features"]);
    expect(missingSections([p("Intro"), h("Features"), p("a")])).toEqual([]);
    expect(missingSections([p("Intro")])).toEqual(["features"]);
  });
});
