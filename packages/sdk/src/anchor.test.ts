import { describe, expect, it } from "vitest";
import { skinParams, tooltipParams, tooltipShowParams } from "./anchor.js";
import { ITEM_CARD_ART_TAGS_TAVORA, ITEM_CARD_BOX_BORDER_TAVORA, ITEM_CARD_COLUMNS_TAVORA, ITEM_CARD_ICON_TAVORA, ITEM_CARD_PER_TAVORA, ITEM_CARD_TAVORA, MENU_DISABLED_REASON_TAVORA, TOOLTIP_ANCHOR_BOX_TAVORA, TOOLTIP_FORMATTING_TAVORA, UNIT_CARD_TAVORA, checkTooltip, type TooltipContent } from "./protocol.js";

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

describe("tooltipShowParams and the stats' extra columns", () => {
  const content: TooltipContent = { title: "A", layout: "card", columns: ["Lv 1", "Lv 2", "Lv 3"], properties: [{ label: "Units", value: "6", more: ["12", "18"] }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6", more: ["", "8.6"], per: "+1" }] };
  const BEFORE = UNIT_CARD_TAVORA;

  it("puts the extra values into per and the later headings into perHeading on a Tavora with per but without columns", () => {
    const sent = tooltipShowParams({ id: "a", at, content }, BEFORE).content;
    expect(sent).toEqual({ title: "A", layout: "card", perHeading: "Lv 2 / Lv 3", properties: [{ label: "Units", value: "6", per: "12 / 18" }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6", per: "– / 8.6 · +1" }] });
    // The caller's content stays as it was.
    expect(content.properties![0]!.more).toEqual(["12", "18"]);
    expect(content.columns).toHaveLength(3);
  });

  it("keeps a perHeading after the folded headings, and leaves the headings out when no stat has an extra value", () => {
    const withHeading = { ...content, perHeading: "Per level" };
    expect(tooltipShowParams({ id: "a", at, content: withHeading }, BEFORE).content.perHeading).toBe("Lv 2 / Lv 3 · Per level");
    const headingsOnly = { title: "A", layout: "card" as const, columns: ["Lv 1", "Lv 2"], properties: [{ label: "Range", value: "3" }, { label: "Damage", value: "", more: [" ", ""], per: "+3" }] };
    expect(tooltipShowParams({ id: "a", at, content: headingsOnly }, BEFORE).content).toEqual({ title: "A", layout: "card", properties: [{ label: "Range", value: "3" }, { label: "Damage", value: "", per: "+3" }] });
  });

  it("keeps the folded texts within the 40 and 60 characters an older Tavora takes", () => {
    const long: TooltipContent = { title: "A", columns: ["x".repeat(20), "y".repeat(20), "z".repeat(20), "w".repeat(20)], properties: [{ label: "Note", value: "1", more: ["a".repeat(40), "b".repeat(40), "c".repeat(40)], per: "+3" }] };
    const sent = tooltipShowParams({ id: "a", at, content: long }, BEFORE).content;
    expect(sent.properties![0]!.per).toHaveLength(40);
    expect(sent.properties![0]!.per!.endsWith("…")).toBe(true);
    expect(sent.perHeading).toHaveLength(60);
  });

  it("puts the folded text into the value on a Tavora without per either", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_TAVORA).content).toEqual({ title: "A", layout: "card", properties: [{ label: "Units", value: "6 · 12 / 18" }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6 · – / 8.6 · +1" }] });
  });

  it("sends them as they are to a Tavora with columns, and a card without them as it is everywhere", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_COLUMNS_TAVORA).content).toEqual(content);
    const plain = { title: "A", perHeading: "Per level", properties: [{ label: "Range", value: "3", per: "+1" }] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, BEFORE).content).toBe(plain);
  });

  it("is used by the memory host's show", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const { sdk, host } = createMemoryHost({ version: BEFORE });
    await sdk.ui.tooltip.show({ id: "a", at, content });
    expect(sdk.supports("ui.tooltip.columns")).toBe(false);
    const shown = (host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content;
    expect("columns" in shown).toBe(false);
    expect(shown.properties!.some((p) => "more" in p)).toBe(false);
  });
});

describe("tooltipShowParams and the tags over the picture", () => {
  const content: TooltipContent = { title: "A", layout: "card", image: "dist/a.png", badges: ["Troop"], artTags: [{ text: "Stone", side: "left" }, { text: "Legendary", color: "#e0a243", side: "right" }] };

  it("adds their texts to the badges in their order, without colour or side, on a Tavora without them", () => {
    const sent = tooltipShowParams({ id: "a", at, content }, ITEM_CARD_COLUMNS_TAVORA).content;
    expect(sent).toEqual({ title: "A", layout: "card", image: "dist/a.png", badges: ["Troop", "Stone", "Legendary"] });
    // The caller's content stays as it was.
    expect(content.badges).toEqual(["Troop"]);
    expect(content.artTags).toHaveLength(2);
    expect(tooltipShowParams({ id: "a", at, content: { title: "A", artTags: [{ text: "Stone" }] } }, ITEM_CARD_COLUMNS_TAVORA).content).toEqual({ title: "A", badges: ["Stone"] });
  });

  it("keeps to the 8 badges a card may have", () => {
    const full = { title: "A", badges: ["1", "2", "3", "4", "5", "6", "7"], artTags: [{ text: "x" }, { text: "y" }, { text: "z" }] };
    expect(tooltipShowParams({ id: "a", at, content: full }, ITEM_CARD_COLUMNS_TAVORA).content.badges).toEqual(["1", "2", "3", "4", "5", "6", "7", "x"]);
  });

  it("sends them as they are to a Tavora with them, and a card without them as it is everywhere", () => {
    expect(tooltipShowParams({ id: "a", at, content }, ITEM_CARD_ART_TAGS_TAVORA).content).toEqual(content);
    const plain = { title: "A", badges: ["Troop"] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, ITEM_CARD_COLUMNS_TAVORA).content).toBe(plain);
  });

  it("is used by the memory host's show", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const { sdk, host } = createMemoryHost({ version: ITEM_CARD_COLUMNS_TAVORA });
    await sdk.ui.tooltip.show({ id: "a", at, content });
    expect(sdk.supports("ui.tooltip.artTags")).toBe(false);
    const shown = (host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content;
    expect("artTags" in shown).toBe(false);
    expect(shown.badges).toEqual(["Troop", "Stone", "Legendary"]);
  });
});

describe("tooltipShowParams and formatting", () => {
  const OLDER = MENU_DISABLED_REASON_TAVORA;
  const content: TooltipContent = {
    title: "Multi Shot",
    layout: "card",
    effect: [{ text: "Shooting " }, { text: "Regular Arrows", italic: true }, { text: " has a " }, { text: "20%", accent: true, strong: true }, { text: " chance." }],
    sections: [{ rows: [{ text: "Affix" }] }],
    blocks: [
      { type: "text", runs: [{ text: "Flavour", italic: true }], tone: "muted" },
      { type: "heading", text: "Found in" },
      { type: "list", items: ["Spire", { text: "Shroud", meta: "Rare" }] },
      { type: "tags", tags: ["Stone", { text: "Legendary", color: "#e0a243" }] },
    ],
    footer: [{ text: "Skill points: ", strong: true }, { text: "3" }],
  };

  it("sends it as it is to a Tavora that knows it, and a card without it as it is everywhere", () => {
    expect(tooltipShowParams({ id: "a", at, content }, TOOLTIP_FORMATTING_TAVORA).content).toEqual(content);
    const plain = { title: "A", effect: [{ text: "12", accent: true }] };
    expect(tooltipShowParams({ id: "a", at, content: plain }, OLDER).content).toBe(plain);
  });

  it("keeps the text and accents but not bold and italic, and makes the blocks and the footer sections, on an older Tavora", () => {
    const sent = tooltipShowParams({ id: "a", at, content }, OLDER).content;
    expect(sent).toEqual({
      title: "Multi Shot",
      layout: "card",
      effect: [{ text: "Shooting " }, { text: "Regular Arrows" }, { text: " has a " }, { text: "20%", accent: true }, { text: " chance." }],
      sections: [{ rows: [{ text: "Affix" }] }, { rows: [{ text: "Flavour" }] }, { title: "Found in", rows: [{ text: "Spire" }, { text: "Shroud", status: "Rare" }, { text: "Stone · Legendary" }] }, { rows: [{ text: "Skill points: 3" }] }],
    });
    // What it sends is what that Tavora takes, and the caller's content stays as it was.
    expect(checkTooltip({ id: "a", at, content: sent }).ok).toBe(true);
    expect(content.blocks).toHaveLength(4);
    expect((content.effect as { italic?: boolean }[])[1]!.italic).toBe(true);
  });

  it("keeps to the 12 sections and 100 rows an older Tavora takes", () => {
    const full: TooltipContent = { title: "A", sections: Array.from({ length: 12 }, () => ({ rows: Array.from({ length: 8 }, () => ({ text: "x" })) })), blocks: [{ type: "list", items: Array.from({ length: 20 }, (_, i) => `l${i}`) }], footer: "Corrupted" };
    const sent = tooltipShowParams({ id: "a", at, content: full }, OLDER).content;
    expect(sent.sections).toHaveLength(12);
    expect(sent.sections!.flatMap((s) => s.rows)).toHaveLength(100);
    expect(sent.sections![11]!.rows.slice(8).map((r) => r.text)).toEqual(["l0", "l1", "l2", "l3"]);
    expect(checkTooltip({ id: "a", at, content: sent }).ok).toBe(true);
    const eleven: TooltipContent = { title: "A", sections: Array.from({ length: 11 }, () => ({ rows: [{ text: "x" }] })), blocks: [{ type: "heading", text: "H" }, { type: "text", text: "t" }], footer: "F" };
    const folded = tooltipShowParams({ id: "a", at, content: eleven }, OLDER).content.sections!;
    expect(folded).toHaveLength(12);
    expect(folded[11]).toEqual({ title: "H", rows: [{ text: "t" }, { text: "F" }] });
  });

  it("keeps a row free for the effect on a Tavora without the effect box, and never throws on content Tavora refuses", () => {
    const full: TooltipContent = { title: "A", effect: "Shoots", sections: Array.from({ length: 9 }, () => ({ rows: Array.from({ length: 11 }, () => ({ text: "x" })) })), footer: "F" };
    const sent = tooltipShowParams({ id: "a", at, content: full }, OLD).content;
    expect(sent.sections!.flatMap((s) => s.rows)).toHaveLength(100);
    expect(checkTooltip({ id: "a", at, content: sent }).ok).toBe(true);
    for (const bad of [{ effect: [null] }, { blocks: [{ type: "list", items: [null] }] }, { blocks: [{ type: "tags", tags: [null] }] }, { sections: {}, footer: "F" }, { footer: [null] }, { blocks: [null, { type: "list" }] }])
      expect(() => tooltipShowParams({ id: "a", at, content: { title: "A", ...(bad as object) } as TooltipContent }, OLDER)).not.toThrow();
  });

  it("is used by the memory host's show", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const { sdk, host } = createMemoryHost({ version: OLDER });
    expect(sdk.supports("ui.tooltip.formatting")).toBe(false);
    await sdk.ui.tooltip.show({ id: "a", at, content });
    const shown = (host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content;
    expect("blocks" in shown || "footer" in shown).toBe(false);
    const latest = createMemoryHost();
    await latest.sdk.ui.tooltip.show({ id: "a", at, content });
    expect((latest.host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content).toEqual(content);
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

describe("tooltipShowParams and the unit layout", () => {
  const BEFORE = TOOLTIP_ANCHOR_BOX_TAVORA;
  const unit: TooltipContent = {
    title: "Soldier",
    layout: "unit",
    skin: "nothing",
    image: "dist/cards/soldier.webp",
    corner: { text: "1800", icon: "dist/icons/person.png" },
    effect: [{ text: "Gains " }, { text: "+1%", accent: true }, { text: " damage per unit." }],
    properties: [{ label: "Health:", value: "3.95", suffix: "E+12" }, { label: "Hits/Second:", value: "99.999", suffix: " (MAX)" }, { label: "Crit Chance:", value: "5%" }],
    icons: [{ image: "dist/cards/steel-coat.webp", label: "Steel Coat", count: "95" }],
    pips: { filled: 3, total: 3, extra: "+67" },
  };

  it("sends a unit card as it is to a Tavora that knows it", () => {
    expect(tooltipShowParams({ id: "a", at, content: unit }, UNIT_CARD_TAVORA).content).toBe(unit);
  });

  it("shows it as a plain card on an older Tavora: no corner, icons or pips, each suffix after its value", () => {
    const { corner: _c, icons: _i, pips: _p, ...rest } = unit;
    expect(tooltipShowParams({ id: "a", at, content: unit }, BEFORE).content).toEqual({ ...rest, layout: "card", properties: [{ label: "Health:", value: "3.95E+12" }, { label: "Hits/Second:", value: "99.999 (MAX)" }, { label: "Crit Chance:", value: "5%" }] });
    expect(unit.layout).toBe("unit");
    expect(unit.properties![0]!.suffix).toBe("E+12");
    // Older still, without item cards: the rich layout, with the effect as a row.
    const rich = tooltipShowParams({ id: "a", at, content: unit }, OLD).content;
    expect(rich).not.toHaveProperty("layout");
    expect(rich.properties![1]!.value).toBe("99.999 (MAX)");
  });

  it("puts a suffix into the value in the other layouts, on every Tavora, cut to 300 characters", () => {
    const card: TooltipContent = { title: "A", layout: "card", properties: [{ label: "Health", value: "3.95", suffix: "E+12" }, { label: "Range", value: "3" }] };
    expect(tooltipShowParams({ id: "a", at, content: card }, UNIT_CARD_TAVORA).content.properties).toEqual([{ label: "Health", value: "3.95E+12" }, { label: "Range", value: "3" }]);
    const long: TooltipContent = { title: "A", properties: [{ label: "Long", value: "x".repeat(290), suffix: "y".repeat(20) }] };
    expect(tooltipShowParams({ id: "a", at, content: long }, UNIT_CARD_TAVORA).content.properties![0]!.value).toHaveLength(300);
  });

  it("leaves the unit's keys out of another layout for an older Tavora, and keeps them for a newer one", () => {
    const card: TooltipContent = { title: "A", layout: "card", corner: { text: "3" }, pips: { filled: 1, total: 3 } };
    expect(tooltipShowParams({ id: "a", at, content: card }, BEFORE).content).toEqual({ title: "A", layout: "card" });
    expect(tooltipShowParams({ id: "a", at, content: card }, UNIT_CARD_TAVORA).content).toBe(card);
  });

  it("is used by the memory host's show", async () => {
    const { createMemoryHost } = await import("./testing.js");
    const old = createMemoryHost({ version: BEFORE });
    expect(old.sdk.supports("ui.tooltip.unit")).toBe(false);
    await old.sdk.ui.tooltip.show({ id: "a", at, content: unit });
    expect((old.host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content.layout).toBe("card");
    const latest = createMemoryHost();
    expect(latest.sdk.supports("ui.tooltip.unit")).toBe(true);
    await latest.sdk.ui.tooltip.show({ id: "a", at, content: unit });
    expect((latest.host.calls["ui.tooltip.show"] as { content: TooltipContent }[])[0]!.content).toEqual(unit);
  });
});

describe("skinParams and the unit layout's bar", () => {
  const skin = { colors: { surface: "#1a150f", text: "#ececec", accent: "#f2c94c", bar: "#776538", boxBorder: "#a07c40" } };

  it("leaves bar out for a Tavora that would refuse the whole skin for it, and sends it to one that knows it", () => {
    expect(skinParams("greed", skin, TOOLTIP_ANCHOR_BOX_TAVORA).skin).toEqual({ colors: { surface: "#1a150f", text: "#ececec", accent: "#f2c94c", boxBorder: "#a07c40" } });
    expect(skinParams("greed", skin, ITEM_CARD_TAVORA).skin).toEqual({ colors: { surface: "#1a150f", text: "#ececec", accent: "#f2c94c" } });
    expect(skin.colors.bar).toBe("#776538");
    expect(skinParams("greed", skin, UNIT_CARD_TAVORA).skin).toBe(skin);
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
