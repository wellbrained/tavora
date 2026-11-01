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
    it("never interprets text as HTML", () => { expect(checkTooltip({ ...base, content: { title: "<b>literal</b>" } }).content.title).toBe("<b>literal</b>"); });
});
