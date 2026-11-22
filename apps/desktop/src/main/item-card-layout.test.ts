// The hover card (the tooltip page, shared/tooltip-document) and the kit's ItemCard (the card inside a panel) lay their
// stats and rows out alike. Here, not beside the tooltip page's own test: reading the kit's stylesheet needs Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLTIP_DOCUMENT } from "../shared/tooltip-document";

const KIT_CSS = readFileSync(new URL("../../../../modules/shared/src/components/ui/item-card/item-card.css", import.meta.url), "utf8");

describe("tooltip page and the kit's card: what a stat grows by, and rows under the stats", () => {
    it("keep what a stat grows by whole: its column takes what it needs, only the label gives way", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats.has-per{grid-template-columns:minmax(72px,1fr) fit-content(36%) auto}");
        expect(KIT_CSS).toContain(".tavora-item-card-stats[data-per]{grid-template-columns:minmax(72px,1fr) fit-content(36%) auto}");
    });

    it("let a row's own text wrap and keep only its status on one line", () => {
        expect(TOOLTIP_DOCUMENT).toContain("li{display:grid;grid-template-columns:minmax(0,1fr) max-content;");
        expect(KIT_CSS).toContain(".tavora-item-card-section li span+span{color:var(--ic-muted);white-space:nowrap}");
        expect(KIT_CSS).not.toContain("li span:last-child");
    });
});

describe("tooltip page and the kit's card: a stat's icon", () => {
    it("draw it alike: a mask in the label's colour, 14 px on the label's first line, 6 px before the label", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stat-icon{flex:0 0 14px;width:14px;height:14px;margin-top:calc((1lh - 14px) / 2)}");
        expect(KIT_CSS).toContain(".tavora-item-card-icon{flex:0 0 14px;width:14px;height:14px;margin-top:calc((1lh - 14px) / 2)}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats.has-icons .stats-label{display:flex;align-items:flex-start;gap:6px}");
        expect(KIT_CSS).toContain(".tavora-item-card-stats[data-icons] .tavora-item-card-label{display:flex;align-items:flex-start;gap:6px}");
        expect(KIT_CSS).toContain(".tavora-item-card-icon[data-drawn]{background-color:currentColor;-webkit-mask:var(--ic-icon) center/contain no-repeat;mask:var(--ic-icon) center/contain no-repeat}");
        expect(KIT_CSS).toContain(".tavora-item-card[data-pixel] .tavora-item-card-icon");
    });
});

describe("tooltip page and the kit's card: a unit", () => {
    it("lay it out alike: portrait, title bar, indented body, three stats columns, framed icons and pips on the edge", () => {
        const both: [string, string][] = [
            ["body.unit .u-card{position:relative;min-width:316px;width:max-content;max-width:520px;padding-top:19px;", ".tavora-item-card[data-layout=unit][data-portrait]{padding-top:19px}"],
            ["width:44px;height:67px;border:2px solid var(--u-line);", "width:44px;height:67px;border:2px solid var(--ic-unit-line);"],
            ["height:34px;margin-left:44px;padding:0 9px 0 6px;", ".tavora-item-card[data-portrait] .tavora-item-card-bar{margin-left:44px;padding-left:6px;border-left:0;border-top-left-radius:0}"],
            ["body.unit .u-body{position:relative;margin-left:24px;padding:12px 14px 24px 31px;", ".tavora-item-card[data-portrait] .tavora-item-card-unit-body{margin-left:24px;padding-left:31px}"],
            ["body.unit .u-stats{display:grid;grid-template-columns:auto auto 1fr;gap:4px 8px}", ".tavora-item-card-unit-stats{display:grid;grid-template-columns:auto auto 1fr;gap:4px 8px}"],
            ["body.unit .u-value{text-align:right;white-space:nowrap}", ".tavora-item-card-unit-value{text-align:right;white-space:nowrap}"],
            ["body.unit .u-suffix{margin-left:-8px;white-space:pre}", ".tavora-item-card-unit-suffix{margin-left:-8px;white-space:pre}"],
            ["width:46px;height:38px;border:2px solid var(--u-line);border-radius:4px;", "width:46px;height:38px;border:2px solid var(--ic-unit-line);border-radius:4px;"],
            ["body.unit .u-icons{display:flex;flex-wrap:wrap;gap:12px 18px}", ".tavora-item-card-icons{display:flex;flex-wrap:wrap;gap:12px 18px}"],
            ["body.unit .u-icon img{display:block;width:38px;height:34px;", ".tavora-item-card-unit-icon img{display:block;width:38px;height:34px;"],
            ["position:absolute;right:-10px;bottom:-10px;padding:0 4px;border:2px solid var(--u-line);border-radius:7px;", "position:absolute;right:-10px;bottom:-10px;padding:0 4px;border:2px solid var(--ic-unit-line);border-radius:7px;"],
            ["body.unit .u-pips{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);display:flex;gap:14px}", ".tavora-item-card-pips{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);display:flex;gap:14px}"],
            ["body.unit .u-extra{position:absolute;left:50%;bottom:-24px;", ".tavora-item-card-extra{position:absolute;left:50%;bottom:-24px;"],
        ];
        for (const [page, kit] of both) {
            expect(TOOLTIP_DOCUMENT).toContain(page);
            expect(KIT_CSS).toContain(kit);
        }
    });

    it("take the skin's bar, or its surface, for the title bar, and its text for the lines", () => {
        expect(TOOLTIP_DOCUMENT).toContain("--u-bar:var(--skin-bar,var(--skin-surface));--u-line:var(--skin-text)");
        expect(KIT_CSS).toContain("--ic-bar:var(--skin-bar,var(--skin-surface));--ic-unit-line:var(--skin-text)");
    });
});
