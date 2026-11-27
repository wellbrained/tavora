import { describe, it, expect } from "vitest";
import { checkTooltip, checkTooltipAnchor } from "./tooltip-content";
const base = { id: "item:1", at: { x: 20, y: 30 }, content: { title: "Armageddon Edge", tone: "rare", image: "dist/assets/bow.webp", sections: [{ rows: [{ text: "Adds 10 to 22 Physical Damage", badges: ["[P5]"], status: "Crafted" }] }] } };
describe("tooltip boundary", () => {
    it("retains plain text, affixes, image path and pin state", () => { expect(checkTooltip({ ...base, pinned: true })).toEqual({ ...base, pinned: true }); });
    it("does not accept markup, styles, URLs, traversal or excessive content", () => {
        for (const content of [{ title: "x", html: "<script>x</script>" }, { title: "x", style: "background:red" }, { title: "x", image: "https://example.org/a.png" }, { title: "x", image: "file:///secret.png" }, { title: "x", image: "dist/../a.png" }, { title: "x", image: "dist/a.svg" }, { title: "x", sections: [{ rows: Array.from({ length: 61 }, () => ({ text: "x" })) }] }])
            expect(() => checkTooltip({ ...base, content })).toThrow();
    });
    it("rejects non-finite coordinates, unknown flags and oversized text", () => { expect(() => checkTooltipAnchor({ id: "x", at: { x: NaN, y: 0 } })).toThrow(); expect(() => checkTooltip({ ...base, pinned: "yes" })).toThrow(); expect(() => checkTooltip({ ...base, content: { title: "x".repeat(201) } })).toThrow(); });
    it("takes a look, neutral or poe, and leaves it out when none is asked for", () => {
        for (const look of ["neutral", "poe"] as const)
            expect(checkTooltip({ ...base, content: { ...base.content, look } }).content.look).toBe(look);
        expect("look" in checkTooltip(base).content).toBe(false);
    });
    it("rejects any other look", () => { for (const look of ["gold", "", "POE", 1, null]) expect(() => checkTooltip({ ...base, content: { ...base.content, look } })).toThrow(); });
    it("takes pinnable: false, and leaves it out otherwise", () => {
        expect(checkTooltip({ ...base, pinnable: false })).toEqual({ ...base, pinned: false, pinnable: false });
        expect("pinnable" in checkTooltip({ ...base, pinnable: true })).toBe(false);
        expect("pinnable" in checkTooltip(base)).toBe(false);
    });
    it("rejects pinnable that is not a boolean, and a pin on a card that can't be pinned", () => {
        for (const pinnable of ["no", 0, null])
            expect(() => checkTooltip({ ...base, pinnable })).toThrow();
        expect(() => checkTooltip({ ...base, pinnable: false, pinned: true })).toThrow();
        expect(checkTooltip({ ...base, pinnable: false, pinned: false }).pinned).toBe(false);
        expect(checkTooltip({ ...base, pinnable: true, pinned: true }).pinned).toBe(true);
    });
    it("takes the card layout, an effect and a skin name, and leaves them out when none is asked for", () => {
        const content = { ...base.content, layout: "card", skin: "chaos-king", effect: [{ text: "Deals " }, { text: "12", accent: true }, { text: " damage", accent: false }] };
        expect(checkTooltip({ ...base, content }).content).toEqual({ ...content, effect: [{ text: "Deals " }, { text: "12", accent: true }, { text: " damage" }] });
        expect(checkTooltip({ ...base, content: { title: "x", layout: "rich", effect: "Plain text" } }).content).toEqual({ title: "x", layout: "rich", effect: "Plain text" });
        for (const key of ["layout", "effect", "skin"])
            expect(key in checkTooltip(base).content).toBe(false);
    });
    it("takes what a stat grows by and its heading, and an empty value only next to a per", () => {
        const content = { title: "x", layout: "card", perHeading: "Per level", properties: [{ label: "Damage", value: "12", per: "+3" }, { label: "Speed", value: "", per: "\u00d71.1" }, { label: "Range", value: "3" }] };
        expect(checkTooltip({ ...base, content }).content).toEqual(content);
        expect("perHeading" in checkTooltip(base).content).toBe(false);
        for (const extra of [{ properties: [{ label: "Range", value: "" }] }, { properties: [{ label: "Range", value: "3", per: "" }] }, { properties: [{ label: "Range", value: "3", per: "x".repeat(41) }] }, { properties: [{ label: "Range", value: "3", per: 3 }] }, { properties: [{ label: "Range", value: 3, per: "+1" }] }, { properties: [{ label: "Range", value: "x".repeat(301), per: "+1" }] }, { properties: [{ label: "Range", value: "3", per: "+1", color: "red" }] }, { perHeading: "" }, { perHeading: "x".repeat(61) }, { perHeading: 1 }])
            expect(() => checkTooltip({ ...base, content: { title: "x", ...extra } })).toThrow();
    });
    it("takes up to 3 tags over the picture with a #rrggbb colour and a side, and leaves them out when none are asked for", () => {
        const content = { title: "x", layout: "card", image: "dist/a.png", badges: ["Troop"], artTags: [{ text: "Stone", side: "left" }, { text: "Legendary", color: "#E0a243", side: "right" }, { text: "x".repeat(24) }] };
        expect(checkTooltip({ ...base, content }).content).toEqual(content);
        expect("artTags" in checkTooltip(base).content).toBe(false);
        const tags = (...artTags: unknown[]) => ({ artTags });
        for (const extra of [{ artTags: [] }, { artTags: "Stone" }, { artTags: { 0: { text: "Stone" } } }, tags({ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }), tags({ text: "x".repeat(25) }), tags({ text: "" }), tags({ text: " " }), tags({ text: 1 }), tags("Stone"), tags(null), tags({ text: "a", color: "red" }), tags({ text: "a", color: "#e0a24" }), tags({ text: "a", color: "#e0a2431" }), tags({ text: "a", color: "#e0a24g" }), tags({ text: "a", color: "e0a243" }), tags({ text: "a", color: "#e0a243;x" }), tags({ text: "a", color: 0xe0a243 }), tags({ text: "a", side: "top" }), tags({ text: "a", side: "Left" }), tags({ text: "a", side: "" }), tags({ text: "a", side: 1 }), tags({ text: "a", tone: "rare" })])
            expect(() => checkTooltip({ ...base, content: { title: "x", ...extra } })).toThrow();
    });
    it("takes extra values after a stat's value and the columns' headings, and an empty value only next to a filled extra", () => {
        const content = { title: "x", layout: "card", columns: ["Lv 1", "Lv 2", "Lv 3", "Max"], perHeading: "Per level", properties: [{ label: "Units", value: "6", more: ["12", "18", "x".repeat(40)] }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6", more: ["", "8.6"], per: "+1" }, { label: "Shield", value: "", more: ["", "4"] }] };
        expect(checkTooltip({ ...base, content }).content).toEqual(content);
        expect("columns" in checkTooltip(base).content).toBe(false);
        const stat = (extra: object) => ({ properties: [{ label: "Range", value: "3", ...extra }] });
        for (const extra of [stat({ more: [] }), stat({ more: ["1", "2", "3", "4"] }), stat({ more: ["x".repeat(41)] }), stat({ more: [1] }), stat({ more: [null] }), stat({ more: "12" }), stat({ more: { 0: "12" } }), stat({ value: "", more: ["", " "] }), stat({ value: 3, more: ["12"] }), stat({ value: "x".repeat(301), more: ["12"] }), { requirements: [{ label: "Level", value: "2", more: ["3"] }] }, { columns: [] }, { columns: ["a", "b", "c", "d", "e"] }, { columns: ["x".repeat(21)] }, { columns: [""] }, { columns: [" "] }, { columns: [1] }, { columns: "Lv 1" }])
            expect(() => checkTooltip({ ...base, content: { title: "x", ...extra } })).toThrow();
    });
    it("takes a stat's icon from the module's bundle by the picture's path rules, with or without a per", () => {
        const content = { title: "x", layout: "card", properties: [{ label: "HP", value: "40", icon: "dist/icons/heart.png" }, { label: "Damage", value: "", per: "+3", icon: "dist/icons/sword.webp" }, { label: "Range", value: "3" }] };
        expect(checkTooltip({ ...base, content }).content).toEqual(content);
        for (const icon of ["https://example.org/a.png", "file:///secret.png", "data:image/png;base64,iVBORw0KGgo=", "/dist/a.png", "dist/../a.png", "dist/a/../../b.png", "dist/a.svg", "dist/a.jpg", "dist/a.jpeg", "dist/a.gif", "icons/a.png", "", "dist/" + "a".repeat(500) + ".png", 1, null])
            expect(() => checkTooltip({ ...base, content: { title: "x", properties: [{ label: "HP", value: "40", icon }] } })).toThrow();
        expect(() => checkTooltip({ ...base, content: { title: "x", requirements: [{ label: "Level", value: "2", icon: "dist/a.png" }] } })).toThrow();
        // Only the icon is a mask: the item picture still takes JPEG and GIF.
        for (const image of ["dist/a.jpg", "dist/a.jpeg", "dist/a.gif"])
            expect(checkTooltip({ ...base, content: { title: "x", image } }).content.image).toBe(image);
    });
    it("rejects another layout, a bad skin name and effects that are too long or not text", () => {
        for (const extra of [{ layout: "grid" }, { layout: "CARD" }, { skin: "Chaos King" }, { skin: "x".repeat(33) }, { skin: "" }, { effect: "" }, { effect: "x".repeat(1001) }, { effect: [] }, { effect: [{ text: " " }] }, { effect: [{ text: "a", accent: "yes" }] }, { effect: [{ text: "a", color: "#ff0000" }] }, { effect: [{ text: "x".repeat(600) }, { text: "x".repeat(401) }] }, { effect: Array.from({ length: 41 }, () => ({ text: "a" })) }, { effect: [{ html: "<b>a</b>" }] }])
            expect(() => checkTooltip({ ...base, content: { title: "x", ...extra } })).toThrow();
    });
    it("takes a unit card: its corner value, stats with a suffix, icon row and pips", () => {
        const content = { title: "Soldier", layout: "unit", skin: "nothing", image: "dist/cards/soldier.webp", corner: { text: "1800", icon: "dist/icons/person.png" }, effect: [{ text: "Gains " }, { text: "+1%", accent: true }], properties: [{ label: "Health:", value: "3.95", suffix: "E+12" }, { label: "Hits/Second:", value: "99.999", suffix: " (MAX)" }, { label: "Crit Chance:", value: "5%" }], icons: [{ image: "dist/cards/steel-coat.webp", label: "Steel Coat", count: "95" }, { image: "dist/cards/static.png", label: "Static" }], pips: { filled: 3, total: 3, extra: "+67" } };
        expect(checkTooltip({ ...base, content }).content).toEqual(content);
        // The suffix keeps its leading space; a corner without an icon and pips without extra are fine.
        const plain = checkTooltip({ ...base, content: { title: "Thief", layout: "unit", corner: { text: "27" }, pips: { filled: 0, total: 1 } } }).content;
        expect(plain.corner).toEqual({ text: "27" });
        expect(plain.pips).toEqual({ filled: 0, total: 1 });
        for (const key of ["corner", "icons", "pips"])
            expect(key in checkTooltip(base).content).toBe(false);
    });
    it("takes the unit card's limits: 20 characters in the corner, 12 icons, 10 pips, 40 characters of suffix", () => {
        const at = (extra: object) => checkTooltip({ ...base, content: { title: "x", layout: "unit", ...extra } }).content;
        expect(at({ corner: { text: "x".repeat(20) } }).corner!.text).toHaveLength(20);
        expect(at({ icons: Array.from({ length: 12 }, (_, i) => ({ image: `dist/i${i}.png`, label: "x".repeat(100), count: "x".repeat(8) })) }).icons).toHaveLength(12);
        expect(at({ pips: { filled: 10, total: 10, extra: "x".repeat(12) } }).pips!.total).toBe(10);
        expect(at({ properties: [{ label: "a", value: "1", suffix: "x".repeat(40) }] }).properties![0]!.suffix).toHaveLength(40);
    });
    it("rejects a unit card's fields that are too long, too many, not whole numbers, or pictures by the wrong rules", () => {
        const icon = { image: "dist/a.png", label: "A" };
        for (const extra of [
            { corner: "27" }, { corner: { text: "" } }, { corner: { text: "x".repeat(21) } }, { corner: { text: "1", icon: "dist/a.jpg" } }, { corner: { text: "1", icon: "https://example.org/a.png" } }, { corner: { text: "1", color: "#fff" } },
            { icons: icon }, { icons: Array.from({ length: 13 }, () => icon) }, { icons: [{ image: "dist/a.png" }] }, { icons: [{ ...icon, label: " " }] }, { icons: [{ ...icon, label: "x".repeat(101) }] }, { icons: [{ ...icon, count: "x".repeat(9) }] }, { icons: [{ ...icon, count: 95 }] }, { icons: [{ ...icon, image: "dist/a.gif" }] }, { icons: [{ ...icon, image: "dist/../a.png" }] }, { icons: [{ ...icon, frame: "gold" }] },
            { pips: { filled: 1 } }, { pips: { filled: 1, total: 0 } }, { pips: { filled: 1, total: 11 } }, { pips: { filled: 4, total: 3 } }, { pips: { filled: -1, total: 3 } }, { pips: { filled: 1.5, total: 3 } }, { pips: { filled: "1", total: 3 } }, { pips: { filled: 1, total: 3, extra: "" } }, { pips: { filled: 1, total: 3, extra: "x".repeat(13) } }, { pips: { filled: 1, total: 3, max: 9 } },
            { properties: [{ label: "a", value: "1", suffix: "" }] }, { properties: [{ label: "a", value: "1", suffix: " " }] }, { properties: [{ label: "a", value: "1", suffix: "x".repeat(41) }] }, { properties: [{ label: "a", value: "1", suffix: 12 }] },
        ])
            expect(() => checkTooltip({ ...base, content: { title: "x", layout: "unit", ...extra } }), JSON.stringify(extra)).toThrow();
        expect(() => checkTooltip({ ...base, content: { title: "x", layout: "UNIT" } })).toThrow();
    });
    it("never interprets text as HTML", () => { expect(checkTooltip({ ...base, content: { title: "<b>literal</b>" } }).content.title).toBe("<b>literal</b>"); });
    it("keeps the anchor's box and refuses a malformed one", () => {
        const box = { x: -4, y: 0, width: 86, height: 86 };
        expect(checkTooltipAnchor({ id: "x", at: { x: 82, y: 43 }, box })).toEqual({ id: "x", at: { x: 82, y: 43 }, box });
        expect(checkTooltip({ ...base, box }).box).toEqual(box);
        expect(checkTooltip(base)).not.toHaveProperty("box");
        expect(() => checkTooltipAnchor({ id: "x", at: { x: 1, y: 1 }, box: { x: 0, y: 0, width: NaN, height: 1 } })).toThrow();
        expect(() => checkTooltipAnchor({ id: "x", at: { x: 1, y: 1 }, box: { x: 0, y: 0, width: 1 } })).toThrow();
        expect(() => checkTooltip({ ...base, box: { x: 0, y: 0, width: 1, height: 1, z: 1 } })).toThrow();
        expect(() => checkTooltip({ ...base, box: [0, 0, 1, 1] })).toThrow();
    });
    it("takes bold and italic runs in the effect, and leaves false flags out", () => {
        const effect = [{ text: "Shooting " }, { text: "Regular Arrows", italic: true }, { text: " has a " }, { text: "20%", accent: true, strong: true }, { text: " chance.\n\nMore", strong: false, italic: false }];
        expect(checkTooltip({ ...base, content: { title: "x", effect } }).content.effect).toEqual([{ text: "Shooting " }, { text: "Regular Arrows", italic: true }, { text: " has a " }, { text: "20%", accent: true, strong: true }, { text: " chance.\n\nMore" }]);
        for (const run of [{ text: "x", italic: "yes" }, { text: "x", strong: 1 }, { text: "x", underline: true }])
            expect(() => checkTooltip({ ...base, content: { title: "x", effect: [run] } })).toThrow();
    });
    it("takes blocks of text, headings, lists and tags, and a footer, as the kit's parts", () => {
        const blocks = [
            { type: "text", runs: [{ text: "A flavour line,\nin italics.", italic: true }], tone: "muted", size: "small" },
            { type: "text", text: "In a box", box: true },
            { type: "heading", text: "Found in" },
            { type: "list", items: ["Ancient Spire", { text: "Shroud", meta: "Rare" }] },
            { type: "tags", tags: ["Stone", { text: "Legendary", color: "#e0a243" }] },
        ];
        const footer = [{ text: "Skill points: ", strong: true }, { text: "3" }];
        expect(checkTooltip({ ...base, content: { title: "x", blocks, footer } }).content).toEqual({ title: "x", blocks, footer });
        expect(checkTooltip({ ...base, content: { title: "x", footer: "Corrupted \u00b7 PoB reference" } }).content.footer).toBe("Corrupted \u00b7 PoB reference");
        // The default tone and size are left out: the kit draws them the same.
        expect(checkTooltip({ ...base, content: { title: "x", blocks: [{ type: "text", text: "x", tone: "default", size: "default", box: false }] } }).content.blocks).toEqual([{ type: "text", text: "x" }]);
        for (const key of ["blocks", "footer"])
            expect(key in checkTooltip(base).content).toBe(false);
    });
    it("refuses blocks and footers that are not plain, bounded text", () => {
        const bad: unknown[] = [
            { blocks: [] }, { blocks: "text" }, { blocks: Array.from({ length: 13 }, () => ({ type: "heading", text: "x" })) },
            { blocks: [{ type: "html", text: "<b>x</b>" }] }, { blocks: [{ text: "x" }] }, { blocks: [{ type: "text" }] },
            { blocks: [{ type: "text", text: "x", runs: [{ text: "x" }] }] }, { blocks: [{ type: "text", text: "x", tone: "loud" }] },
            { blocks: [{ type: "text", text: "x", size: 12 }] }, { blocks: [{ type: "text", text: "x", box: "yes" }] },
            { blocks: [{ type: "text", text: "x", style: "color:red" }] }, { blocks: [{ type: "text", text: "x".repeat(1001) }] },
            { blocks: [{ type: "text", runs: [{ text: "x".repeat(600) }, { text: "y".repeat(401) }] }] }, { blocks: [{ type: "text", runs: [{ text: " " }] }] },
            { blocks: [{ type: "text", text: "tab\there" }] }, { blocks: [{ type: "text", text: "a\u202eb" }] }, { blocks: [{ type: "text", text: "a\u200bb" }] },
            { blocks: [{ type: "text", runs: [{ text: "a\u2066b" }] }] }, { blocks: [{ type: "heading", text: "two\nlines" }] }, { blocks: [{ type: "heading", text: "x".repeat(101) }] },
            { blocks: [{ type: "list", items: [] }] }, { blocks: [{ type: "list", items: Array.from({ length: 21 }, () => "x") }] }, { blocks: [{ type: "list", items: [{ text: "x", meta: "y".repeat(41) }] }] },
            { blocks: [{ type: "list", items: [{ text: "x", color: "red" }] }] }, { blocks: [{ type: "list", items: ["a\nb"] }] },
            { blocks: [{ type: "tags", tags: [] }] }, { blocks: [{ type: "tags", tags: ["x".repeat(25)] }] }, { blocks: [{ type: "tags", tags: Array.from({ length: 9 }, () => "x") }] },
            { blocks: [{ type: "tags", tags: [{ text: "x", color: "red" }] }] }, { blocks: [{ type: "tags", tags: [{ text: "x", color: "url(x)" }] }] },
            { footer: "" }, { footer: "two\nlines" }, { footer: "x".repeat(301) }, { footer: [{ text: "a\u202eb" }] }, { footer: [] }, { footer: 3 }, { footer: [{ text: "x", accent: "y" }] },
        ];
        for (const extra of bad)
            expect(() => checkTooltip({ ...base, content: { title: "x", ...(extra as object) } }), JSON.stringify(extra)).toThrow();
    });
});
