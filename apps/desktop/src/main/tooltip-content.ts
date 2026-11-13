import type { TooltipAnchor, TooltipContent, TooltipRequest } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { SKIN_NAME } from "./tooltip-skin";
const ID = /^[a-zA-Z0-9._:-]{1,64}$/;
function fail(): never { throw new HostError("INVALID_PARAMS", "invalid tooltip content"); }
function obj(v: unknown, keys: string[]): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v))
    fail(); const o = v as Record<string, unknown>; if (Object.keys(o).some(k => !keys.includes(k)))
    fail(); return o; }
function text(v: unknown, max = 500): string { if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(); return v; }
function list<T>(v: unknown, limit: number, fn: (v: unknown) => T): T[] { if (!Array.isArray(v) || v.length > limit)
    fail(); return v.map(fn); }
/** The card's effect text: one text, or up to 40 runs (some in the accent colour), 1,000 characters in all. */
function effect(v: unknown): NonNullable<TooltipContent["effect"]> {
    if (typeof v === "string")
        return text(v, 1000);
    let length = 0;
    const runs = list(v, 40, r => { const run = obj(r, ["text", "accent"]); if (typeof run.text !== "string" || !run.text || (length += run.text.length) > 1000)
        fail(); if (run.accent !== undefined && typeof run.accent !== "boolean")
        fail(); return { text: run.text, ...(run.accent === true ? { accent: true } : {}) }; });
    if (!runs.length || !runs.some(r => r.text.trim()))
        fail();
    return runs;
}
/** A raster picture in the module's own bundle (`dist/…`): the item picture, or a stat's icon. Read in later (tooltip-images.ts). */
function bundleImage(v: unknown): string {
    const image = text(v, 500);
    if (!/^dist\/(?:[a-zA-Z0-9_. -]+\/)*[a-zA-Z0-9_. -]+\.(?:png|jpe?g|webp|gif)$/i.test(image) || image.split("/").includes(".."))
        fail();
    return image;
}
export function tooltipId(v: unknown): string { const o = obj(v, ["id"]); const id = text(o.id, 64); if (!ID.test(id))
    fail(); return id; }
export function checkTooltipAnchor(v: unknown): TooltipAnchor {
    const o = obj(v, ["id", "at"]), id = tooltipId({ id: o.id }), p = obj(o.at, ["x", "y"]);
    for (const n of [p.x, p.y])
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100000)
            fail();
    return { id, at: { x: p.x as number, y: p.y as number } };
}
export function checkTooltip(v: unknown): TooltipRequest {
    const o = obj(v, ["id", "at", "content", "pinned", "pinnable"]), anchor = checkTooltipAnchor({ id: o.id, at: o.at });
    if (o.pinned !== undefined && typeof o.pinned !== "boolean")
        fail();
    if (o.pinnable !== undefined && typeof o.pinnable !== "boolean")
        fail();
    // A card that says it can't be pinned never pins: asking for both is a mistake, not something to guess at.
    if (o.pinnable === false && o.pinned === true)
        fail();
    const c = obj(o.content, ["title", "subtitle", "look", "tone", "image", "layout", "effect", "skin", "badges", "requirements", "properties", "perHeading", "sections"]);
    const content: TooltipContent = { title: text(c.title, 200) };
    if (c.subtitle !== undefined)
        content.subtitle = text(c.subtitle, 300);
    if (c.look !== undefined) {
        if (!["neutral", "poe"].includes(c.look as string))
            fail();
        content.look = c.look as NonNullable<TooltipContent["look"]>;
    }
    if (c.tone !== undefined) {
        if (!["normal", "magic", "rare", "unique"].includes(c.tone as string))
            fail();
        content.tone = c.tone as NonNullable<TooltipContent["tone"]>;
    }
    if (c.image !== undefined)
        content.image = bundleImage(c.image);
    if (c.layout !== undefined) {
        if (!["rich", "card"].includes(c.layout as string))
            fail();
        content.layout = c.layout as NonNullable<TooltipContent["layout"]>;
    }
    if (c.effect !== undefined)
        content.effect = effect(c.effect);
    if (c.skin !== undefined) {
        if (typeof c.skin !== "string" || !SKIN_NAME.test(c.skin))
            fail();
        content.skin = c.skin;
    }
    if (c.badges !== undefined)
        content.badges = list(c.badges, 8, v => text(v, 100));
    const property = (v: unknown) => { const p = obj(v, ["label", "value"]); return { label: text(p.label, 100), value: text(p.value, 300) }; };
    if (c.requirements !== undefined)
        content.requirements = list(c.requirements, 8, property);
    // A stat may grow by `per` (a third column on the card); with it, its value may be empty (it only grows). Its `icon`
    // is a picture in the module's bundle, by the same rules as `image`.
    const stat = (v: unknown) => {
        const p = obj(v, ["label", "value", "per", "icon"]);
        if (p.per !== undefined && (typeof p.value !== "string" || p.value.length > 300))
            fail();
        const row: NonNullable<TooltipContent["properties"]>[number] = p.per === undefined ? property({ label: p.label, value: p.value }) : { label: text(p.label, 100), value: p.value as string, per: text(p.per, 40) };
        if (p.icon !== undefined)
            row.icon = bundleImage(p.icon);
        return row;
    };
    if (c.properties !== undefined)
        content.properties = list(c.properties, 20, stat);
    if (c.perHeading !== undefined)
        content.perHeading = text(c.perHeading, 60);
    let rows = 0;
    if (c.sections !== undefined)
        content.sections = list(c.sections, 12, v => { const s = obj(v, ["title", "rows"]); return { ...(s.title === undefined ? {} : { title: text(s.title, 100) }), rows: list(s.rows, 60, v => { if (++rows > 100)
                fail(); const r = obj(v, ["text", "badges", "status", "connected"]); if (r.connected !== undefined && typeof r.connected !== "boolean")
                fail(); return { text: text(r.text, 2000), ...(r.badges === undefined ? {} : { badges: list(r.badges, 5, v => text(v, 40)) }), ...(r.status === undefined ? {} : { status: text(r.status, 60) }), ...(r.connected === undefined ? {} : { connected: r.connected as boolean }) }; }) }; });
    if (JSON.stringify(content).length > 40000)
        fail();
    return { ...anchor, content, pinned: o.pinned === true, ...(o.pinnable === false ? { pinnable: false } : {}) };
}
