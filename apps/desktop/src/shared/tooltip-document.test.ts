import { describe, expect, it } from "vitest";
import { TOOLTIP_DOCUMENT } from "./tooltip-document";

// The growth column itself: main/item-card-layout.test.ts, beside the kit card's.
// The card is 280 px wide and a stat's value may be 300 characters: the stats must wrap, not run out of the card.
describe("tooltip page: the card's effect box", () => {
    it("has the theme's line around it on a plain card and the skin's 2 px edge only when the skin gives one", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card:not(.skinned):not(.poe) .effect{border:1px solid var(--line)}");
        expect(TOOLTIP_DOCUMENT).toContain("body.skin-colors.box-edge .effect{border:2px solid var(--skin-box-border)}");
        // No other rule gives the effect box an edge: the rich layout's box stays as it was.
        const edged = (TOOLTIP_DOCUMENT.match(/[^{}`]*\.effect\{[^}]*border:[^}]*\}/g) ?? []).map(rule => rule.trim().split("{")[0]);
        expect(edged).toEqual(["body.card:not(.skinned):not(.poe) .effect", "body.skin-colors.box-edge .effect"]);
    });
});

describe("tooltip page: the card's stats", () => {
    it("lets values, what they grow by and the heading wrap, and keeps room for the label", () => {
        const rules = TOOLTIP_DOCUMENT.match(/[^{}]*(?:\.stats|\.per-heading|\.per\b)[^{}]*\{[^}]*\}/g) ?? [];
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules)
            expect(rule).not.toContain("nowrap");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats>*{min-width:0;overflow-wrap:anywhere}");
    });
});

describe("tooltip page: a stat's icon", () => {
    it("is a mask in the label's colour, the label's height, centred on its first line, with hard pixels on a pixel skin", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stat-icon.drawn{background-color:currentColor;-webkit-mask:var(--stat-icon) center/contain no-repeat;mask:var(--stat-icon) center/contain no-repeat}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stat-icon{flex:0 0 14px;width:14px;height:14px;margin-top:calc((1lh - 14px) / 2)}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats.has-icons .stats-label{display:flex;align-items:flex-start;gap:6px}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card.pixel .stat-icon{image-rendering:pixelated}");
        // Only a drawn icon paints: an empty one keeps the room and shows nothing.
        expect(TOOLTIP_DOCUMENT.match(/[^{}]*\.stat-icon[^{}]*\{[^}]*background[^}]*\}/g)!.map(rule => rule.split("{")[0])).toEqual(["body.card .stat-icon.drawn"]);
        // The page loads pictures only as data: URLs.
        expect(TOOLTIP_DOCUMENT).toContain("img-src data:;");
    });
});
