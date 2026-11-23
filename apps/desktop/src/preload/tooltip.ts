import { ipcRenderer } from "electron";
import type { TooltipContent, TavoraTheme } from "@tavora/sdk/protocol";
import { footerTexts } from "../shared/tooltip-footer";
/** A module's skin as the host checked it, its files read in as data: URLs (main/tooltip-skin.ts). */
interface Skin {
    frame?: { image: string; slice: [number, number, number, number] };
    colors?: { surface: string; text: string; muted: string; accent: string; box: string; boxText: string; boxBorder?: string; bar?: string };
    font?: string;
    pixelArt: boolean;
    titleCaps: boolean;
}
interface Data {
    serial: number;
    content: TooltipContent;
    pinned: boolean;
    pinnable: boolean;
    source: string;
    theme: TavoraTheme;
    language: string;
    /** The id of a skin the host sent before ("tooltip:skin"). */
    skin?: number;
    /** The tallest the card can be in the window; the window may be smaller while the last card is still in sight. */
    room?: number;
    /** A card is in sight: it stays drawn until the host has placed the window for this one (tooltip:placed). */
    keep?: boolean;
}
/** How long a new card waits for its pictures and letters before its size counts as final anyway. */
const SETTLE_MS = 150;
/** The skins the host sent this page, by id; it drops them when the module's skin is replaced or gone. */
const skins = new Map<number, Skin>();
/** The newest card the host sent. */
let current: Data | undefined;
/** The card in the page now: the one before `current` while that one waits to be placed. */
let drawn: Data | undefined;
// The host made these; they are checked again here, so nothing but a colour or a base64 data: URL reaches the styles.
const HEX = /^#[0-9a-f]{6}$/i, FRAME = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, FONT = /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/;
// A stat's icon, read in by the host (main/tooltip-images.ts) and checked again before it reaches a style.
const ICON = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const SKIN_VARS = { surface: "--skin-surface", text: "--skin-text", muted: "--skin-muted", accent: "--skin-accent", box: "--skin-box", boxText: "--skin-box-text", boxBorder: "--skin-box-border", bar: "--skin-bar" } as const;
let face: FontFace | undefined, faceSource: string | undefined;
// FontFaceSet is a set of FontFaces; the DOM types here leave out its add and delete.
const fonts = () => document.fonts as unknown as Set<FontFace>;
/** The skin's font as "tavora-skin": loaded once for each font, and measured again when it arrives. */
function skinFont(source: string | undefined): boolean {
    if (source !== faceSource) {
        if (face)
            fonts().delete(face);
        face = undefined;
        faceSource = source;
        if (source && typeof FontFace === "function") {
            face = new FontFace("tavora-skin", `url("${source}")`);
            fonts().add(face);
            face.load().then(measure, () => { });
        }
    }
    return !!face;
}
/** Dresses the card in a module's skin, or takes the last one off. Sizes stay the page's own. */
function applySkin(card: HTMLElement, skin: Skin | undefined) {
    const body = document.body;
    for (const name of Object.values(SKIN_VARS))
        card.style.removeProperty(name);
    for (const name of ["border-image-source", "border-image-slice", "border-width"])
        card.style.removeProperty(name);
    const colors = skin?.colors && Object.values(skin.colors).every(v => HEX.test(v)) ? skin.colors : undefined;
    if (colors)
        for (const [key, name] of Object.entries(SKIN_VARS)) {
            const value = colors[key as keyof typeof SKIN_VARS];
            if (value)
                card.style.setProperty(name, value);
        }
    const frame = skin?.frame && FRAME.test(skin.frame.image) && skin.frame.slice.length === 4 && skin.frame.slice.every(n => Number.isInteger(n) && n >= 0 && n <= 64) ? skin.frame : undefined;
    if (frame) {
        card.style.setProperty("border-image-source", `url("${frame.image}")`);
        card.style.setProperty("border-image-slice", frame.slice.join(" "));
        card.style.setProperty("border-width", frame.slice.map(n => n + "px").join(" "));
    }
    const font = skinFont(skin?.font && FONT.test(skin.font) ? skin.font : undefined);
    body.classList.toggle("skinned", !!skin);
    body.classList.toggle("skin-colors", !!colors);
    body.classList.toggle("box-edge", !!colors?.boxBorder);
    body.classList.toggle("framed", !!frame);
    body.classList.toggle("skin-font", font);
    body.classList.toggle("caps", !!skin?.titleCaps);
    body.classList.toggle("pixel", !!skin?.pixelArt);
    return frame;
}
/** The effect box: plain text runs, the accent ones in a span of their own. */
function effectBox(effect: NonNullable<TooltipContent["effect"]>, className = "effect") {
    const box = node("div", undefined, className);
    if (typeof effect === "string")
        box.textContent = effect;
    else
        for (const run of effect)
            box.append(run.accent ? node("span", run.text, "accent") : document.createTextNode(run.text));
    return box;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) { const el = document.createElement(tag); if (text !== undefined)
    el.textContent = text; if (className)
    el.className = className; return el; }
function render(data: Data) {
    current = data;
    if (!data.keep || !drawn)
        draw(data);
    settle(data);
}
/** Lays a card out in the page. */
function draw(data: Data) {
    drawn = data;
    const c = data.content, card = document.getElementById("card")!;
    card.replaceChildren();
    document.body.classList.remove("compact");
    // The neutral look (the default) follows the user's theme through its tokens; the PoE look has fixed colours of its own and
    // only takes the theme's text and background (see tooltip-document.ts).
    const poe = c.look === "poe";
    document.body.classList.toggle("poe", poe);
    for (const [name, value] of Object.entries(data.theme.tokens))
        if (typeof value === "string" && CSS.supports("color", value))
            document.documentElement.style.setProperty("--" + name, value);
    card.style.color = poe ? data.theme.colors.text : "";
    const bg = data.theme.colors.background;
    if (/^#[a-f0-9]{3,8}$/i.test(bg))
        card.style.setProperty("--bg", bg);
    const de = data.language === "de";
    const cardLayout = c.layout === "card", unitLayout = c.layout === "unit";
    document.body.classList.toggle("card", cardLayout);
    document.body.classList.toggle("unit", unitLayout);
    // A skin's colours ignore the theme, like the PoE look; a skinned card isn't PoE, and neither is a unit. A unit card
    // has a shape of its own, so it wears no frame.
    const worn = (cardLayout || unitLayout) && data.skin !== undefined ? skins.get(data.skin) : undefined;
    const skin = unitLayout && worn ? (({ frame: _frame, ...rest }) => rest)(worn) : worn;
    const frame = applySkin(card, skin);
    if (skin || unitLayout)
        document.body.classList.remove("poe");
    let close: HTMLButtonElement | undefined;
    if (data.pinned) {
        close = node("button", "\u00d7");
        close.id = "close";
        close.setAttribute("aria-label", de ? "Details schlie\u00dfen" : "Close item details");
        close.onclick = () => ipcRenderer.send("tooltip:close", data.serial);
        if (frame) {
            close.style.top = frame.slice[0] + 2 + "px";
            close.style.right = frame.slice[1] + 4 + "px";
        }
        // A unit card has it at the end of its title bar.
        if (!unitLayout)
            card.append(close);
    }
    if (unitLayout) {
        renderUnit(card, c, close);
        const footer = node("div", undefined, "footer");
        footer.append(...footerTexts(data.source, data, de).map(t => node("span", t)));
        card.append(footer);
        fit(data);
        return;
    }
    if (cardLayout) {
        renderCard(card, c, de);
        const footer = node("div", undefined, "footer");
        footer.append(...footerTexts(data.source, data, de).map(t => node("span", t)));
        card.append(footer);
        fit(data);
        return;
    }
    const layout = node("div", undefined, "");
    layout.id = "layout";
    card.append(layout);
    const art = node("div", undefined, "art");
    layout.append(art);
    if (c.image) {
        const image = node("img");
        image.src = c.image;
        image.alt = "";
        image.onload = measure;
        art.append(image);
    }
    if (c.requirements?.length) {
        const req = node("div", undefined, "requirements");
        req.append(node("small", de ? "Ben\u00f6tigt" : "Requires"));
        for (const r of c.requirements) {
            const row = node("div", undefined, "requirement");
            row.append(node("span", r.label), node("b", r.value));
            req.append(row);
        }
        art.append(req);
    }
    const details = node("div", undefined, "details");
    layout.append(details);
    const heading = node("div", undefined, "heading");
    heading.append(node("h2", c.title, c.tone));
    // The rich layout has no tags over the picture: they follow the badges.
    for (const b of withTagBadges(c))
        heading.append(node("span", b, "badge"));
    details.append(heading);
    if (c.subtitle)
        details.append(node("div", c.subtitle, "subtitle"));
    if (c.effect)
        details.append(effectBox(c.effect));
    appendRows(details, c);
    const footer = node("div", undefined, "footer");
    footer.append(...footerTexts(data.source, data, de).map(t => node("span", t)));
    card.append(footer);
    fit(data);
}
/**
 * Measures the card now, and again as final once its pictures are decoded and its letters loaded (or after SETTLE_MS):
 * the window only comes into sight, or moves to a card that waits, at the final size, so the card shows once instead of
 * growing a moment later. A card that waits sends only its final size, so the one in sight stays where it is until then.
 */
function settle(data: Data) {
    const { pictures } = measureOf(data);
    if (drawn === data)
        sendSize(false);
    const decoded = pictures.map(image => typeof image.decode === "function" ? image.decode().catch(() => { }) : undefined);
    const waited = Promise.all([...decoded, document.fonts?.ready]);
    void Promise.race([waited, new Promise(resolve => setTimeout(resolve, SETTLE_MS))]).then(() => { if (current === data)
        sendSize(true); });
}
/** Compact when the card is taller than the window can be. */
function fit(data: Data) {
    const card = document.getElementById("card")!, room = data.room ?? innerHeight;
    if (card.scrollHeight > room && room > 100)
        document.body.classList.add("compact");
}
/**
 * The size and pictures of `data`. A card that waits is drawn for a moment and the one in sight drawn back, all in this
 * task, so it never reaches the screen; laying it out also starts loading its letters.
 */
function measureOf(data: Data) {
    const back = drawn !== data ? drawn : undefined;
    if (back)
        draw(data);
    else
        fit(data);
    const card = document.getElementById("card")!;
    const size = { height: card.scrollHeight, width: Math.ceil(card.getBoundingClientRect().width), pictures: Array.from(card.querySelectorAll("img")) };
    if (back)
        draw(back);
    return size;
}
/** The item card: the picture large on top, the name bar, type line, badges, effect box, then the rows. */
function renderCard(card: HTMLElement, c: TooltipContent, de: boolean) {
    const item = node("div", undefined, "item");
    card.append(item);
    if (c.image) {
        const art = node("div", undefined, "card-art"), image = node("img");
        image.src = c.image;
        image.alt = "";
        image.onload = measure;
        art.append(image);
        if (c.artTags?.length)
            art.append(artTags(c.artTags));
        item.append(art);
    }
    // The title row: the name, and the badges right-aligned beside it (under it on their own when they don't fit).
    // Without a picture the tags over it are badges too.
    const name = node("div", undefined, "name");
    name.append(node("h2", c.title, c.tone));
    const shown = c.image ? c.badges ?? [] : withTagBadges(c);
    if (shown.length) {
        const badges = node("div", undefined, "badges");
        for (const b of shown)
            badges.append(node("span", b, "badge"));
        name.append(badges);
    }
    item.append(name);
    if (c.subtitle)
        item.append(node("div", c.subtitle, "subtitle"));
    if (c.effect)
        item.append(effectBox(c.effect));
    if (c.properties?.length)
        item.append(stats(c.properties, c.perHeading, c.columns));
    const { properties: _stats, ...rows } = c;
    appendRows(item, rows);
    // Requirements come last, as rows like the properties, under their own heading.
    if (c.requirements?.length) {
        const section = node("section", undefined, "card-requirements");
        section.append(node("small", de ? "Ben\u00f6tigt" : "Requires"), stats(c.requirements));
        item.append(section);
    }
}
/**
 * The tags over the card's picture: a row in its bottom-left corner and one in its bottom-right (the default), each
 * only when a tag sits there. A tag's colour (checked again here, as it goes into a style) sets its text and edge;
 * without one it keeps the card's text and line colours.
 */
function artTags(tags: NonNullable<TooltipContent["artTags"]>) {
    const corners = node("div", undefined, "art-tags");
    for (const side of ["left", "right"] as const) {
        const here = tags.filter(tag => (tag.side === "left" ? "left" : "right") === side);
        if (!here.length)
            continue;
        const row = node("div", undefined, side);
        for (const tag of here) {
            const el = node("span", tag.text, "art-tag");
            if (tag.color && HEX.test(tag.color)) {
                el.style.color = tag.color;
                el.style.borderColor = tag.color;
            }
            row.append(el);
        }
        corners.append(row);
    }
    return corners;
}
/** The badges, and after them the texts of the tags over the picture, where there is no picture to put them on. */
function withTagBadges(c: TooltipContent) {
    return [...(c.badges ?? []), ...(c.artTags ?? []).map(tag => tag.text)];
}
/**
 * The card's stats: label, value, the extra values (`more`) each in a column of its own and, when a row of the card has
 * one, how much it grows (`per`) in a last column. `columns` head the value and the extra columns, `heading` the `per`
 * column. No colons: the columns line the values up. The number columns take what they need and the label wraps; only
 * when that isn't enough do long values wrap. When a row has an icon, every label keeps room for one, so the labels
 * still line up.
 */
function stats(rows: { label: string; value: string; per?: string; icon?: string; suffix?: string; more?: string[] }[], heading?: string, columns?: string[]) {
    const per = rows.some(r => r.per !== undefined), icons = rows.some(r => r.icon !== undefined);
    const extra = Math.min(3, Math.max(0, (columns?.length ?? 0) - 1, ...rows.map(r => r.more?.length ?? 0)));
    const grid = node("div", undefined, "stats" + (per ? " has-per" : "") + (extra ? " has-columns" : "") + (icons ? " has-icons" : ""));
    if (extra)
        grid.style.setProperty("--stat-columns", String(1 + extra + (per ? 1 : 0)));
    const blank = (n: number) => Array.from({ length: n }, () => node("span"));
    if (columns?.length) {
        grid.append(node("span"));
        for (let i = 0; i <= extra; i++)
            grid.append(columns[i] ? node("small", columns[i], "per-heading") : node("span"));
        if (per)
            grid.append(heading ? node("small", heading, "per-heading") : node("span"));
    }
    else if (per && heading)
        grid.append(...blank(2 + extra), node("small", heading, "per-heading"));
    for (const r of rows) {
        const label = node("span", icons ? undefined : r.label, "stats-label");
        if (icons)
            label.append(statIcon(r.icon), document.createTextNode(r.label));
        // Only the unit layout hangs a suffix past the value; here it is part of it.
        grid.append(label, node("span", r.value + (r.suffix ?? ""), "value"));
        // "–" in an extra column means the stat doesn't change there: drawn faint.
        for (let i = 0; i < extra; i++)
            grid.append(node("span", r.more?.[i] ?? "", r.more?.[i] === "–" ? "more faint" : "more"));
        if (per)
            grid.append(node("span", r.per ?? "", "per"));
    }
    return grid;
}
/**
 * A stat in one line, for the rich layout: the value, its extra values and what it grows by, "6 · 12 · 18 · +3". An
 * empty extra value in between shows as "–", empty ones at the end are left out.
 */
function inlineStat(p: { value: string; per?: string; suffix?: string; more?: string[] }) {
    const own = p.value + (p.suffix ?? "");
    const cells = [own, ...(p.more ?? [])];
    while (cells.length && !cells[cells.length - 1]!.trim())
        cells.pop();
    const values = cells.map(cell => (cell.trim() ? cell : "–")).join(" · ");
    return p.per === undefined ? values || own : values ? values + " · " + p.per : p.per;
}
/**
 * A stat's icon: only its shape, as a mask in the label's colour (so it follows the theme and the skin). It is
 * decoration, the label stays the stat's name. Without a usable picture it only keeps the room.
 */
function statIcon(src: string | undefined) {
    const icon = node("span", undefined, "stat-icon");
    icon.setAttribute("aria-hidden", "true");
    if (src && ICON.test(src)) {
        icon.classList.add("drawn");
        icon.style.setProperty("--stat-icon", `url("${src}")`);
    }
    return icon;
}
/**
 * A game unit as games show it on the board: the portrait sticking out at the top left, the title bar with the title
 * and the corner value, then the body: type line, effect, stats, sections, the icon row and the pips on its bottom edge.
 * Badges, requirements and a stat's `per` and `icon` aren't part of it.
 */
function renderUnit(card: HTMLElement, c: TooltipContent, close: HTMLButtonElement | undefined) {
    const unit = node("div", undefined, "u-card" + (c.image ? "" : " no-portrait") + (c.pips ? " has-pips" : "") + (c.pips?.extra ? " has-extra" : ""));
    card.append(unit);
    if (c.image) {
        const portrait = node("div", undefined, "u-portrait"), image = node("img");
        image.src = c.image;
        image.alt = "";
        image.onload = measure;
        portrait.append(image);
        unit.append(portrait);
    }
    const bar = node("div", undefined, "u-bar");
    bar.append(node("h2", c.title));
    if (c.corner) {
        const corner = node("span", undefined, "u-corner");
        corner.append(node("span", c.corner.text));
        // Only its shape counts, like a stat's icon: a mask in the title's colour, checked before it reaches the style.
        if (c.corner.icon && ICON.test(c.corner.icon)) {
            const icon = node("span", undefined, "u-corner-icon");
            icon.setAttribute("aria-hidden", "true");
            icon.style.setProperty("--u-icon", `url("${c.corner.icon}")`);
            corner.append(icon);
        }
        bar.append(corner);
    }
    if (close)
        bar.append(close);
    unit.append(bar);
    const body = node("div", undefined, "u-body");
    unit.append(body);
    if (c.subtitle)
        body.append(node("div", c.subtitle, "subtitle"));
    if (c.effect)
        body.append(effectBox(c.effect, "u-effect"));
    if (c.properties?.length) {
        // Label, value and suffix: the labels as wide as the longest, the values lined up on their right edge and the
        // suffix hanging past it, so the numbers of "3.95E+12" and "99.999 (MAX)" stay in line.
        const grid = node("div", undefined, "u-stats");
        for (const p of c.properties)
            grid.append(node("span", p.label, "u-label"), node("span", p.value, "u-value"), node("span", p.suffix ?? "", "u-suffix"));
        body.append(grid);
    }
    if (c.sections?.length)
        appendRows(body, { title: c.title, sections: c.sections });
    if (c.icons?.length) {
        const row = node("div", undefined, "u-icons");
        for (const i of c.icons) {
            const frame = node("span", undefined, "u-icon");
            frame.setAttribute("role", "img");
            frame.setAttribute("aria-label", i.count ? `${i.label} (${i.count})` : i.label);
            // A picture the host couldn't read leaves the frame empty.
            if (ICON.test(i.image)) {
                const image = node("img");
                image.src = i.image;
                image.alt = "";
                image.onload = measure;
                frame.append(image);
            }
            if (i.count) {
                const count = node("span", i.count, "u-count");
                count.setAttribute("aria-hidden", "true");
                frame.append(count);
            }
            row.append(frame);
        }
        body.append(row);
    }
    if (c.pips) {
        const pips = node("div", undefined, "u-pips");
        pips.setAttribute("role", "img");
        pips.setAttribute("aria-label", `${c.pips.filled} / ${c.pips.total}${c.pips.extra ? " " + c.pips.extra : ""}`);
        for (let i = 0; i < c.pips.total; i++)
            pips.append(node("span", undefined, i < c.pips.filled ? "u-pip on" : "u-pip"));
        body.append(pips);
        if (c.pips.extra) {
            const extra = node("div", c.pips.extra, "u-extra");
            extra.setAttribute("aria-hidden", "true");
            body.append(extra);
        }
    }
}
/** Properties and sections, the same in both layouts. */
function appendRows(details: HTMLElement, c: TooltipContent) {
    if (c.properties?.length) {
        const props = node("div", undefined, "properties");
        for (const p of c.properties) {
            const row = node("div");
            // The rich layout has no more columns: the extra values and what a stat grows by follow its value, and so
            // does its suffix.
            row.append(node("span", p.label ? p.label + ": " : ""), node("span", inlineStat(p), "value"));
            props.append(row);
        }
        details.append(props);
    }
    for (const s of c.sections || []) {
        const section = node("section");
        if (s.title)
            section.append(node("small", s.title));
        const ul = node("ul");
        for (const r of s.rows) {
            const li = node("li", undefined, r.connected ? "connected" : undefined);
            li.append(node("span", r.text, "text"));
            const right = node("span", undefined, "affixes");
            if (r.status)
                right.append(node("small", r.status, "status"));
            for (const badge of r.badges || [])
                right.append(node("span", badge));
            li.append(right);
            ul.append(li);
        }
        section.append(ul);
        details.append(section);
    }
}
/** Tells the host the card's size; also an image's onload and a font's load call it, with an argument that isn't this flag. */
function measure() { sendSize(false); }
function sendSize(final: boolean) {
    // A card that waits sends only its final size (settle).
    if (!current || (!final && drawn !== current))
        return;
    const { height, width } = measureOf(current);
    ipcRenderer.send("tooltip:size", current.serial, height, width, final);
}
ipcRenderer.on("tooltip:skin", (_event, id: number, skin: Skin) => { skins.set(id, skin); });
ipcRenderer.on("tooltip:skin-drop", (_event, ids: number[]) => { for (const id of ids)
    skins.delete(id); });
ipcRenderer.on("tooltip:render", (_event, data: Data) => render(data));
// The window is at the card's final size: a card that waited takes the place of the one in sight now, and once a frame of
// it is drawn there, the host shows it (when it was unseen).
ipcRenderer.on("tooltip:placed", (_event, serial: number) => {
    if (current?.serial !== serial)
        return;
    if (drawn !== current)
        draw(current);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (current?.serial === serial)
        ipcRenderer.send("tooltip:drawn", serial); }));
});
window.addEventListener("DOMContentLoaded", () => ipcRenderer.send("tooltip:ready"));
// The interface font comes in its own stylesheet; text measured before its files were in is measured again.
document.fonts?.addEventListener("loadingdone", () => measure());
