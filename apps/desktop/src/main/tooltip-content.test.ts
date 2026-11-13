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
        for (const icon of ["https://example.org/a.png", "file:///secret.png", "data:image/png;base64,iVBORw0KGgo=", "/dist/a.png", "dist/../a.png", "dist/a/../../b.png", "dist/a.svg", "icons/a.png", "", "dist/" + "a".repeat(500) + ".png", 1, null])
            expect(() => checkTooltip({ ...base, content: { title: "x", properties: [{ label: "HP", value: "40", icon }] } })).toThrow();
        expect(() => checkTooltip({ ...base, content: { title: "x", requirements: [{ label: "Level", value: "2", icon: "dist/a.png" }] } })).toThrow();
    });
    it("rejects another layout, a bad skin name and effects that are too long or not text", () => {
        for (const extra of [{ layout: "grid" }, { layout: "CARD" }, { skin: "Chaos King" }, { skin: "x".repeat(33) }, { skin: "" }, { effect: "" }, { effect: "x".repeat(1001) }, { effect: [] }, { effect: [{ text: " " }] }, { effect: [{ text: "a", accent: "yes" }] }, { effect: [{ text: "a", color: "#ff0000" }] }, { effect: [{ text: "x".repeat(600) }, { text: "x".repeat(401) }] }, { effect: Array.from({ length: 41 }, () => ({ text: "a" })) }, { effect: [{ html: "<b>a</b>" }] }])
            expect(() => checkTooltip({ ...base, content: { title: "x", ...extra } })).toThrow();
    });
    it("never interprets text as HTML", () => { expect(checkTooltip({ ...base, content: { title: "<b>literal</b>" } }).content.title).toBe("<b>literal</b>"); });
});
