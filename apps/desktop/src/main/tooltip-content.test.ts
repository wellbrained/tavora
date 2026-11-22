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
});
