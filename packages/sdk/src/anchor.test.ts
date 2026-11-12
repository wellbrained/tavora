import { describe, expect, it } from "vitest";
import { tooltipShowParams } from "./anchor.js";
import { ITEM_CARD_PER_TAVORA, ITEM_CARD_TAVORA } from "./protocol.js";

const at = { x: 1, y: 2 };
const OLD = "0.24.0";

describe("tooltipShowParams on a Tavora without item cards", () => {
  it("leaves layout and skin out and keeps the effect as the first row, as plain text", () => {
    const sent = tooltipShowParams({ id: "a", at, content: { title: "A", layout: "card", skin: "gold", effect: [{ text: "Deals " }, { text: "12", accent: true }], sections: [{ title: "More", rows: [{ text: "x" }] }] } }, OLD);
    expect(sent.content).toEqual({ title: "A", sections: [{ rows: [{ text: "Deals 12" }] }, { title: "More", rows: [{ text: "x" }] }] });
    expect(tooltipShowParams({ id: "a", at, content: { title: "A", effect: "Plain" } }, OLD).content).toEqual({ title: "A", sections: [{ rows: [{ text: "Plain" }] }] });
  });

  it("puts the effect into the first section when there are already 12", () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({ rows: [{ text: "row " + i }] }));
    const sent = tooltipShowParams({ id: "a", at, content: { title: "A", effect: "Hit", sections } }, OLD).content.sections!;
    expect(sent).toHaveLength(12);
    expect(sent[0]!.rows.map((r) => r.text)).toEqual(["Hit", "row 0"]);
    expect(sections[0]!.rows).toHaveLength(1);
  });

  it("sends the card as it is to a Tavora with item cards", () => {
    const content = { title: "A", layout: "card" as const, skin: "gold", effect: "Hit" };
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_TAVORA).content).toEqual(content);
  });
});

describe("tooltipShowParams and the stats' third column", () => {
  const content = { title: "A", layout: "card" as const, perHeading: "Per level", properties: [{ label: "Damage", value: "12", per: "+3" }, { label: "Speed", value: "", per: "×1.1" }, { label: "Range", value: "3" }] };

  it("puts what a stat grows by into its value and drops the heading on a Tavora without the column", () => {
    const sent = tooltipShowParams({ id: "a", at, content }, ITEM_CARD_TAVORA).content;
    expect(sent).toEqual({ title: "A", layout: "card", properties: [{ label: "Damage", value: "12 · +3" }, { label: "Speed", value: "×1.1" }, { label: "Range", value: "3" }] });
    expect(content.properties[0]!.per).toBe("+3");
    // A Tavora without item cards at all gets both fallbacks.
    expect(tooltipShowParams({ id: "a", at, content }, OLD).content).toEqual({ title: "A", properties: [{ label: "Damage", value: "12 · +3" }, { label: "Speed", value: "×1.1" }, { label: "Range", value: "3" }] });
  });

  it("sends per and the heading as they are to a Tavora with the column, and leaves a card without them alone", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_PER_TAVORA).content).toEqual(content);
    const plain = { title: "A", properties: [{ label: "Range", value: "3" }] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, ITEM_CARD_TAVORA).content).toBe(plain);
  });
});
