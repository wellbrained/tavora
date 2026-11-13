import { describe, expect, it } from "vitest";
import { skinParams, tooltipParams, tooltipShowParams } from "./anchor.js";
import { ITEM_CARD_BOX_BORDER_TAVORA, ITEM_CARD_ICON_TAVORA, ITEM_CARD_PER_TAVORA, ITEM_CARD_TAVORA, TOOLTIP_ANCHOR_BOX_TAVORA } from "./protocol.js";

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

  it("keeps a folded value within the 300 characters an older Tavora takes", () => {
    const long = { title: "A", properties: [{ label: "Note", value: "x".repeat(298), per: "+3" }] };
    expect(tooltipShowParams({ id: "a", at, content: long }, ITEM_CARD_TAVORA).content.properties![0]!.value).toHaveLength(300);
  });

  it("sends per and the heading as they are to a Tavora with the column, and leaves a card without them alone", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_PER_TAVORA).content).toEqual(content);
    const plain = { title: "A", properties: [{ label: "Range", value: "3" }] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, ITEM_CARD_TAVORA).content).toBe(plain);
  });
});

describe("tooltipShowParams and the stats' icons", () => {
  const content = { title: "A", layout: "card" as const, properties: [{ label: "HP", value: "40", icon: "dist/icons/heart.png" }, { label: "Damage", value: "12", per: "+3", icon: "dist/icons/sword.png" }, { label: "Range", value: "3" }] };

  it("leaves the icons out for a Tavora that would refuse the tooltip for them, and keeps the labels", () => {
    const sent = tooltipShowParams({ id: "a", at, content }, ITEM_CARD_BOX_BORDER_TAVORA).content;
    expect(sent).toEqual({ title: "A", layout: "card", properties: [{ label: "HP", value: "40" }, { label: "Damage", value: "12", per: "+3" }, { label: "Range", value: "3" }] });
    expect(content.properties[0]!.icon).toBe("dist/icons/heart.png");
    // Older still: no icons and the growth folded into the value.
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_TAVORA).content.properties).toEqual([{ label: "HP", value: "40" }, { label: "Damage", value: "12 · +3" }, { label: "Range", value: "3" }]);
  });

  it("sends the icons as they are to a Tavora that knows them, and a card without them as it is everywhere", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_ICON_TAVORA).content).toEqual(content);
    const plain = { title: "A", properties: [{ label: "Range", value: "3" }] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, ITEM_CARD_BOX_BORDER_TAVORA).content).toBe(plain);
  });

  it("is used by the memory host's show", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const { sdk, host } = createMemoryHost({ version: ITEM_CARD_BOX_BORDER_TAVORA });
    await sdk.ui.tooltip.show({ id: "a", at, content });
    expect(sdk.supports("ui.tooltip.propertyIcon")).toBe(false);
    const shown = (host.calls["ui.tooltip.show"] as { content: { properties: object[] } }[])[0]!.content;
    expect(shown.properties.some((p) => "icon" in p)).toBe(false);
  });
});

describe("skinParams and the effect box's edge", () => {
  const skin = { colors: { surface: "#1e1610", text: "#f4e6c8", box: "#2c2016", boxBorder: "#a07c40" }, titleCaps: true };

  it("leaves boxBorder out for a Tavora that would refuse the whole skin for it", () => {
    expect(skinParams("gold", skin, ITEM_CARD_TAVORA)).toEqual({ name: "gold", skin: { colors: { surface: "#1e1610", text: "#f4e6c8", box: "#2c2016" }, titleCaps: true } });
    expect(skin.colors.boxBorder).toBe("#a07c40");
  });

  it("sends it as it is to a Tavora that knows it, and a skin without it as it is everywhere", () => {
    expect(skinParams("gold", skin, ITEM_CARD_BOX_BORDER_TAVORA).skin).toBe(skin);
    const plain = { titleCaps: true };
    expect(skinParams("gold", plain, ITEM_CARD_TAVORA).skin).toBe(plain);
  });
});

it("is used by the memory host's defineSkin", async () => {
  const { createMemoryHost } = await import("./testing.js");
  const { sdk, host } = createMemoryHost({ version: ITEM_CARD_PER_TAVORA });
  await sdk.ui.tooltip.defineSkin("gold", { colors: { surface: "#1e1610", text: "#f4e6c8", boxBorder: "#a07c40" } });
  expect(sdk.supports("ui.tooltip.boxBorder")).toBe(false);
  expect(host.calls["ui.tooltip.defineSkin"]).toEqual([{ name: "gold", skin: { colors: { surface: "#1e1610", text: "#f4e6c8" } } }]);
});

describe("tooltip params and the anchor's box", () => {
  const element = { getBoundingClientRect: () => ({ x: 10, y: 20, width: 86, height: 86 }) } as unknown as Element;
  const content = { title: "Plot" };
  const box = { x: 10, y: 20, width: 86, height: 86 };

  it("sends the element's box beside at to a Tavora that takes it, for show and move", () => {
    expect(tooltipShowParams({ id: "a", anchor: element, content }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", content, at: { x: 96, y: 63 }, box });
    expect(tooltipParams({ id: "a", anchor: element }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", at: { x: 96, y: 63 }, box });
    expect(tooltipParams({ id: "a", anchor: box }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", at: { x: 96, y: 63 }, box });
  });

  it("leaves it out for an older Tavora, which would refuse the whole call for it", () => {
    expect(tooltipShowParams({ id: "a", anchor: element, content }, ITEM_CARD_ICON_TAVORA)).toEqual({ id: "a", content, at: { x: 96, y: 63 } });
    expect(tooltipParams({ id: "a", anchor: element }, ITEM_CARD_ICON_TAVORA)).toEqual({ id: "a", at: { x: 96, y: 63 } });
  });

  it("sends no box for a point, or an anchor without a size", () => {
    expect(tooltipShowParams({ id: "a", at, content }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", at, content });
    expect(tooltipParams({ id: "a", anchor: { x: 5, y: 6 } }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", at: { x: 5, y: 6 } });
  });

  it("passes a box given with at on only where Tavora takes it", () => {
    expect(tooltipShowParams({ id: "a", at: { x: 96, y: 63 }, box, content }, TOOLTIP_ANCHOR_BOX_TAVORA)).toEqual({ id: "a", at: { x: 96, y: 63 }, box, content });
    expect(tooltipShowParams({ id: "a", at: { x: 96, y: 63 }, box, content }, ITEM_CARD_ICON_TAVORA)).toEqual({ id: "a", at: { x: 96, y: 63 }, content });
  });

  it("is used by the memory host's show and move", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const { sdk, host } = createMemoryHost({ version: TOOLTIP_ANCHOR_BOX_TAVORA });
    await sdk.ui.tooltip.show({ id: "a", anchor: element, content });
    await sdk.ui.tooltip.move({ id: "a", anchor: element });
    expect((host.calls["ui.tooltip.show"] as { box?: object }[])[0]!.box).toEqual(box);
    expect((host.calls["ui.tooltip.move"] as { box?: object }[])[0]!.box).toEqual(box);
    const old = createMemoryHost({ version: ITEM_CARD_ICON_TAVORA });
    await old.sdk.ui.tooltip.move({ id: "a", anchor: element });
    expect(old.host.calls["ui.tooltip.move"]![0]).not.toHaveProperty("box");
  });
});
