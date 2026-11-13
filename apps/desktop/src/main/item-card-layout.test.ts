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
