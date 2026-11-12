import { ipcRenderer } from "electron";
import type { TooltipContent, TavoraTheme } from "@tavora/sdk/protocol";
import { footerTexts } from "../shared/tooltip-footer";
/** A module's skin as the host checked it, its files read in as data: URLs (main/tooltip-skin.ts). */
interface Skin {
    frame?: { image: string; slice: [number, number, number, number] };
    colors?: { surface: string; text: string; muted: string; accent: string; box: string; boxText: string };
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
    skin?: Skin;
}
let current: Data | undefined;
// The host made these; they are checked again here, so nothing but a colour or a base64 data: URL reaches the styles.
const HEX = /^#[0-9a-f]{6}$/i, FRAME = /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, FONT = /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/;
const SKIN_VARS = { surface: "--skin-surface", text: "--skin-text", muted: "--skin-muted", accent: "--skin-accent", box: "--skin-box", boxText: "--skin-box-text" } as const;
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
        for (const [key, name] of Object.entries(SKIN_VARS))
            card.style.setProperty(name, colors[key as keyof typeof SKIN_VARS]);
    const frame = skin?.frame && FRAME.test(skin.frame.image) && skin.frame.slice.length === 4 && skin.frame.slice.every(n => Number.isInteger(n) && n >= 0 && n <= 64) ? skin.frame : undefined;
    if (frame) {
        card.style.setProperty("border-image-source", `url("${frame.image}")`);
        card.style.setProperty("border-image-slice", frame.slice.join(" "));
        card.style.setProperty("border-width", frame.slice.map(n => n + "px").join(" "));
    }
    const font = skinFont(skin?.font && FONT.test(skin.font) ? skin.font : undefined);
    body.classList.toggle("skinned", !!skin);
    body.classList.toggle("skin-colors", !!colors);
    body.classList.toggle("framed", !!frame);
    body.classList.toggle("skin-font", font);
    body.classList.toggle("caps", !!skin?.titleCaps);
    body.classList.toggle("pixel", !!skin?.pixelArt);
    return frame;
}
/** The effect box: plain text runs, the accent ones in a span of their own. */
function effectBox(effect: NonNullable<TooltipContent["effect"]>) {
    const box = node("div", undefined, "effect");
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
    const cardLayout = c.layout === "card";
    document.body.classList.toggle("card", cardLayout);
    // A skin's colours ignore the theme, like the PoE look; a skinned card isn't PoE.
    const frame = applySkin(card, cardLayout ? data.skin : undefined);
    if (cardLayout && data.skin)
        document.body.classList.remove("poe");
    if (data.pinned) {
        const close = node("button", "\u00d7");
        close.id = "close";
        close.setAttribute("aria-label", de ? "Details schlie\u00dfen" : "Close item details");
        close.onclick = () => ipcRenderer.send("tooltip:close", data.serial);
        if (frame) {
            close.style.top = frame.slice[0] + 2 + "px";
            close.style.right = frame.slice[1] + 4 + "px";
        }
        card.append(close);
    }
    if (cardLayout) {
        renderCard(card, c);
        const footer = node("div", undefined, "footer");
        footer.append(...footerTexts(data.source, data, de).map(t => node("span", t)));
        card.append(footer);
        measure();
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
    for (const b of c.badges || [])
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
    measure();
}
/** The item card: the picture large on top, the name bar, type line, badges, effect box, then the rows. */
function renderCard(card: HTMLElement, c: TooltipContent) {
    const item = node("div", undefined, "item");
    card.append(item);
    if (c.image) {
        const art = node("div", undefined, "card-art"), image = node("img");
        image.src = c.image;
        image.alt = "";
        image.onload = measure;
        art.append(image);
        item.append(art);
    }
    const name = node("div", undefined, "name");
    name.append(node("h2", c.title, c.tone));
    item.append(name);
    if (c.subtitle)
        item.append(node("div", c.subtitle, "subtitle"));
    if (c.badges?.length) {
        const badges = node("div", undefined, "badges");
        for (const b of c.badges)
            badges.append(node("span", b, "badge"));
        item.append(badges);
    }
    if (c.effect)
        item.append(effectBox(c.effect));
    appendRows(item, c);
}
/** Properties and sections, the same in both layouts. */
function appendRows(details: HTMLElement, c: TooltipContent) {
    if (c.properties?.length) {
        const props = node("div", undefined, "properties");
        for (const p of c.properties) {
            const row = node("div");
            row.append(node("span", p.label ? p.label + ": " : ""), node("span", p.value, "value"));
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
function measure() { if (!current)
    return; const card = document.getElementById("card")!; if (card.scrollHeight > innerHeight && innerHeight > 100)
    document.body.classList.add("compact"); ipcRenderer.send("tooltip:size", current.serial, card.scrollHeight, Math.ceil(card.getBoundingClientRect().width)); }
ipcRenderer.on("tooltip:render", (_event, data: Data) => render(data));
window.addEventListener("DOMContentLoaded", () => ipcRenderer.send("tooltip:ready"));
