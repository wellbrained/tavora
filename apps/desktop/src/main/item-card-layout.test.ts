// The hover card (the tooltip page, shared/tooltip-document) and the kit's ItemCard (the card inside a panel) lay their
// stats and rows out alike. Here, not beside the tooltip page's own test: reading the kit's stylesheet needs Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLTIP_DOCUMENT } from "../shared/tooltip-document";

const KIT_CSS = readFileSync(new URL("../../../../modules/shared/src/components/ui/item-card/item-card.css", import.meta.url), "utf8");

describe("tooltip page and the kit's card: what a stat grows by, and rows under the stats", () => {
    it("under a picture, move the name row in to line up with the picture's tags (the close button sits over the picture, so no room for it)", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .card-art+.name{padding:0 6px}");
        expect(KIT_CSS).toContain(".tavora-item-card-art+.tavora-item-card-name{padding:0 6px}");
    });

    it("keep what a stat grows by whole: its column takes what it needs, only the label gives way", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats.has-per{grid-template-columns:minmax(72px,1fr) fit-content(36%) auto}");
        expect(KIT_CSS).toContain(".tavora-item-card-stats[data-per]{grid-template-columns:minmax(72px,1fr) fit-content(36%) auto}");
    });

    it("give extra value columns what they need and let the label wrap, in the accent colour like what a stat grows by", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats.has-columns{grid-template-columns:minmax(72px,1fr) repeat(var(--stat-columns),auto)}");
        expect(KIT_CSS).toContain(".tavora-item-card-stats[data-columns]{grid-template-columns:minmax(72px,1fr) repeat(var(--ic-columns),auto)}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .per,body.card .more{color:var(--primary,#e0a243)}");
        expect(KIT_CSS).toContain(".tavora-item-card-per,.tavora-item-card-more{color:var(--ic-accent)}");
    });

    it("put the tags over the picture in its bottom corners, 6 px in, on a mostly opaque patch of the card's surface", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .art-tags{position:absolute;left:6px;right:6px;bottom:6px;display:flex;align-items:flex-end;gap:4px}");
        expect(KIT_CSS).toContain(".tavora-item-card-art-tags{position:absolute;left:6px;right:6px;bottom:6px;display:flex;align-items:flex-end;gap:4px}");
        expect(TOOLTIP_DOCUMENT).toContain("body.card .art-tags>div{display:flex;flex-wrap:wrap-reverse;gap:4px;min-width:0}body.card .art-tags>.right{margin-left:auto;justify-content:flex-end}");
        expect(KIT_CSS).toContain(".tavora-item-card-art-tags>div{display:flex;flex-wrap:wrap-reverse;gap:4px;min-width:0}");
        expect(KIT_CSS).toContain(".tavora-item-card-art-tags>[data-side=right]{margin-left:auto;justify-content:flex-end}");
        expect(TOOLTIP_DOCUMENT).toContain("line-height:1.4;padding:0 6px;border:1px solid var(--line);border-radius:3px;background:color-mix(in srgb,var(--surface) 82%,transparent);white-space:nowrap}");
        expect(KIT_CSS).toContain("line-height:1.4;padding:0 6px;border:1px solid var(--ic-line);border-radius:var(--radius-sm);background:color-mix(in srgb,var(--ic-surface) 82%,transparent);color:var(--ic-text);white-space:nowrap}");
        expect(TOOLTIP_DOCUMENT).toContain("body.skinned .art-tag{border-radius:0}");
        expect(KIT_CSS).toContain(".tavora-item-card[data-skinned] .tavora-item-card-art-tag{border-radius:0}");
    });

    it("draw a \u2013 in an extra column faint, in the label's colour", () => {
        expect(TOOLTIP_DOCUMENT).toContain("body.card .stats .more.faint{color:var(--soft);opacity:.55}");
        expect(TOOLTIP_DOCUMENT).toContain("body.skin-colors .stats .more.faint{color:var(--skin-muted)}");
        expect(KIT_CSS).toContain(".tavora-item-card-more[data-faint]{color:var(--ic-muted);opacity:.55}");
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

describe("tooltip page and the kit's card: the PoE look's frame", () => {
    // The corner pieces and colours are written out in both; the card in a panel must look like the one above the workspace.
    const frames = (css: string) => [...new Set([...css.matchAll(/url\("data:image\/svg\+xml,[^"]*"\)/g)].map(([url]) => url))];

    it("draws the same four frames, one for each rarity and one for the rest", () => {
        expect(frames(TOOLTIP_DOCUMENT)).toHaveLength(4);
        expect(frames(KIT_CSS)).toEqual(frames(TOOLTIP_DOCUMENT));
        for (const tone of ["magic", "rare", "unique"]) {
            const frame = (css: string, selector: string) => css.split(selector)[1]!.match(/url\("[^"]*"\)/)![0];
            expect(frame(KIT_CSS, ":has(h3[data-tone=" + tone + "]){")).toBe(frame(TOOLTIP_DOCUMENT, "body.poe #card:has(h2." + tone + "){"));
        }
    });

    it("tints the picture's edge by rarity in both", () => {
        expect(KIT_CSS).toContain(".tavora-item-card-rich-art>img{border-color:var(--ic-frame-mid)}");
        expect(TOOLTIP_DOCUMENT).toContain("body.poe .art img{border-color:var(--frame-mid)}");
    });

    it("is a border picture reaching 3px out in both, with a diamond on each divider", () => {
        expect(KIT_CSS).toContain("border-image:var(--ic-frame) 26 / 26px / 3px stretch");
        expect(TOOLTIP_DOCUMENT).toContain("border-image:var(--frame) 26 / 26px / 3px stretch");
        // The window keeps the 3px the pieces reach out by (preload/tooltip.ts adds the card's margin to its size).
        expect(TOOLTIP_DOCUMENT).toContain("body.poe #card{margin:3px;max-height:calc(100vh - 6px);");
        for (const css of [KIT_CSS, TOOLTIP_DOCUMENT])
            expect(css).toContain("top:-3.5px;box-sizing:border-box;width:6px;height:6px;margin-left:-3px;rotate:45deg;");
    });
});
