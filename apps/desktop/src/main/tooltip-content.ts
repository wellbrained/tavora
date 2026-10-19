import type { TooltipAnchor, TooltipContent, TooltipRequest } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
const ID = /^[a-zA-Z0-9._:-]{1,64}$/;
function fail(): never { throw new HostError("INVALID_PARAMS", "invalid tooltip content"); }
function obj(v: unknown, keys: string[]): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v))
    fail(); const o = v as Record<string, unknown>; if (Object.keys(o).some(k => !keys.includes(k)))
    fail(); return o; }
function text(v: unknown, max = 500): string { if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(); return v; }
function list<T>(v: unknown, limit: number, fn: (v: unknown) => T): T[] { if (!Array.isArray(v) || v.length > limit)
    fail(); return v.map(fn); }
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
    const o = obj(v, ["id", "at", "content", "pinned"]), anchor = checkTooltipAnchor({ id: o.id, at: o.at });
    if (o.pinned !== undefined && typeof o.pinned !== "boolean")
        fail();
    const c = obj(o.content, ["title", "subtitle", "tone", "image", "badges", "requirements", "properties", "sections"]);
    const content: TooltipContent = { title: text(c.title, 200) };
    if (c.subtitle !== undefined)
        content.subtitle = text(c.subtitle, 300);
    if (c.tone !== undefined) {
        if (!["normal", "magic", "rare", "unique"].includes(c.tone as string))
            fail();
        content.tone = c.tone as NonNullable<TooltipContent["tone"]>;
    }
    if (c.image !== undefined) {
        const image = text(c.image, 500);
        if (!/^dist\/(?:[a-zA-Z0-9_. -]+\/)*[a-zA-Z0-9_. -]+\.(?:png|jpe?g|webp|gif)$/i.test(image) || image.split("/").includes(".."))
            fail();
        content.image = image;
    }
    if (c.badges !== undefined)
        content.badges = list(c.badges, 8, v => text(v, 100));
    const property = (v: unknown) => { const p = obj(v, ["label", "value"]); return { label: text(p.label, 100), value: text(p.value, 300) }; };
    if (c.requirements !== undefined)
        content.requirements = list(c.requirements, 8, property);
    if (c.properties !== undefined)
        content.properties = list(c.properties, 20, property);
    let rows = 0;
    if (c.sections !== undefined)
        content.sections = list(c.sections, 12, v => { const s = obj(v, ["title", "rows"]); return { ...(s.title === undefined ? {} : { title: text(s.title, 100) }), rows: list(s.rows, 60, v => { if (++rows > 100)
                fail(); const r = obj(v, ["text", "badges", "status", "connected"]); if (r.connected !== undefined && typeof r.connected !== "boolean")
                fail(); return { text: text(r.text, 2000), ...(r.badges === undefined ? {} : { badges: list(r.badges, 5, v => text(v, 40)) }), ...(r.status === undefined ? {} : { status: text(r.status, 60) }), ...(r.connected === undefined ? {} : { connected: r.connected as boolean }) }; }) }; });
    if (JSON.stringify(content).length > 40000)
        fail();
    return { ...anchor, content, pinned: o.pinned === true };
}
