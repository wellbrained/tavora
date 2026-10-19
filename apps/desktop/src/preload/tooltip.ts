import { ipcRenderer } from "electron";
import type { TooltipContent, TavoraTheme } from "@tavora/sdk/protocol";
interface Data {
    serial: number;
    content: TooltipContent;
    pinned: boolean;
    source: string;
    theme: TavoraTheme;
    language: string;
}
let current: Data | undefined;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) { const el = document.createElement(tag); if (text !== undefined)
    el.textContent = text; if (className)
    el.className = className; return el; }
function render(data: Data) {
    current = data;
    const c = data.content, card = document.getElementById("card")!;
    card.replaceChildren();
    document.body.classList.remove("compact");
    card.style.color=data.theme.colors.text;
    const bg = data.theme.colors.background;
    if (/^#[a-f0-9]{3,8}$/i.test(bg))
        card.style.setProperty("--bg", bg);
    const de = data.language === "de";
    if (data.pinned) {
        const close = node("button", "\u00d7");
        close.id = "close";
        close.setAttribute("aria-label", de ? "Details schlie\u00dfen" : "Close item details");
        close.onclick = () => ipcRenderer.send("tooltip:close", data.serial);
        card.append(close);
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
    const footer = node("div", undefined, "footer");
    footer.append(node("span", data.source), node("span", data.pinned ? (de ? "Angeheftet \u00b7 Esc zum Schlie\u00dfen" : "Pinned \u00b7 Escape to close") : (de ? "Klicken zum Anheften" : "Click to pin item details")));
    card.append(footer);
    measure();
}
function measure() { if (!current)
    return; const card = document.getElementById("card")!; if (card.scrollHeight > innerHeight && innerHeight > 100)
    document.body.classList.add("compact"); ipcRenderer.send("tooltip:size", current.serial, card.scrollHeight); }
ipcRenderer.on("tooltip:render", (_event, data: Data) => render(data));
window.addEventListener("DOMContentLoaded", () => ipcRenderer.send("tooltip:ready"));
