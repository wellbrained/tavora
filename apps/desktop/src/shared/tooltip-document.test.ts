import { describe, expect, it } from "vitest";
import { TOOLTIP_DOCUMENT } from "./tooltip-document";

// The card is 280 px wide and a stat's value may be 300 characters: the stats must wrap, not run out of the card.
describe("tooltip page: the card's stats", () => {
    it("lets values, what they grow by and the heading wrap, and keeps room for the label", () => {
        const rules = TOOLTIP_DOCUMENT.match(/[^{}]*(?:\.stats|\.per-heading|\.per\b)[^{}]*\{[^}]*\}/g) ?? [];
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules)
            expect(rule).not.toContain("nowrap");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats>*{min-width:0;overflow-wrap:anywhere}");
        expect(TOOLTIP_DOCUMENT).toMatch(/body\.card \.stats\.has-per\{grid-template-columns:minmax\(72px,1fr\) fit-content\(36%\) fit-content\(24%\)\}/);
    });
});
