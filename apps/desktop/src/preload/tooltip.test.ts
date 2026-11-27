// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TooltipContent } from "@tavora/sdk/protocol";

// The tooltip window's preload, on the page the host loads: what a card looks like once the host sent it.
const ipc = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, data: unknown) => void>(), sent: [] as unknown[][] }));
vi.mock("electron", () => ({ ipcRenderer: { on: (channel: string, fn: (event: unknown, data: unknown) => void) => ipc.handlers.set(channel, fn), send: (...args: unknown[]) => ipc.sent.push(args) } }));

const theme = { colors: { text: "#f2ece0", background: "#171412" }, tokens: { primary: "#e0a243" } };
const FRAME = "data:image/png;base64,iVBORw0KGgo=";
const FONT = "data:font/woff2;base64,d09GMgAB";
const skin = { frame: { image: FRAME, slice: [6, 8, 6, 8] }, colors: { surface: "#14110f", text: "#f2ece0", muted: "#b8ad9c", accent: "#e8b04a", box: "#231d18", boxText: "#f2ece0" }, font: FONT, pixelArt: true, titleCaps: true };
let serial = 0, skinIds = 0;
const send = (channel: string, ...args: unknown[]) => (ipc.handlers.get(channel) as unknown as (...a: unknown[]) => void)({}, ...args);
/** Renders a card; a skin given as an object is sent first, once, as the host does, and the card names its id. */
function render(content: TooltipContent, extra: Record<string, unknown> = {}) {
    if (extra.skin && typeof extra.skin === "object") {
        const id = ++skinIds;
        send("tooltip:skin", id, extra.skin);
        extra = { ...extra, skin: id };
    }
    send("tooltip:render", { serial: ++serial, content, pinned: false, pinnable: true, source: "9 Kings", theme, language: "en", ...extra });
    return document.getElementById("card")!;
}
const card: TooltipContent = { title: "Archer Tower", subtitle: "Tower · Kingdom of Nothing", layout: "card", image: "data:image/png;base64,iVBORw0KGgo=", badges: ["Rare"], effect: [{ text: "Shoots for " }, { text: "12", accent: true }, { text: " damage" }], properties: [{ label: "Range", value: "3" }] };

beforeAll(async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    document.body.innerHTML = '<div id="card"></div>';
    await import("./tooltip");
});
beforeEach(() => { document.body.className = ""; });

describe("tooltip preload", () => {
    it("lays a card out with the picture on top, the title with its badges, type line, effect box and stats", () => {
        const el = render(card);
        expect(document.body.classList.contains("card")).toBe(true);
        const item = el.querySelector(".item")!;
        expect(Array.from(item.children).map(c => c.className)).toEqual(["card-art", "name", "subtitle", "effect", "stats"]);
        expect(Array.from(item.querySelector(".name")!.children).map(c => c.tagName.toLowerCase() + "." + c.className)).toEqual(["h2.", "div.badges"]);
        expect(item.querySelector(".name h2")!.textContent).toBe("Archer Tower");
        // Two columns without a colon when no stat grows.
        expect(Array.from(item.querySelector(".stats")!.children).map(c => c.textContent)).toEqual(["Range", "3"]);
        expect(item.querySelector(".per, .per-heading")).toBeNull();
        expect(item.querySelector(".effect")!.textContent).toBe("Shoots for 12 damage");
        expect(Array.from(item.querySelectorAll(".effect .accent")).map(a => a.textContent)).toEqual(["12"]);
        expect(el.querySelector(".footer")!.textContent).toContain("Click to pin item details");
        expect(el.querySelector("#layout")).toBeNull();
        expect(ipc.sent.some(m => m[0] === "tooltip:size")).toBe(true);
    });

    it("keeps module text as text", () => {
        const el = render({ ...card, title: "<img src=x onerror=alert(1)>", effect: "<b>bold</b>" });
        expect(el.querySelector("h2")!.textContent).toBe("<img src=x onerror=alert(1)>");
        expect(el.querySelector(".effect")!.children).toHaveLength(0);
        expect(el.querySelector("b,img[src=x]")).toBeNull();
    });

    it("dresses a skinned card in its colours, frame, font, capitals and hard pixels, and takes it off again", () => {
        const el = render(card, { skin });
        expect(Array.from(document.body.classList).sort()).toEqual(["caps", "card", "framed", "pixel", "skin-colors", "skinned"].concat(typeof FontFace === "function" ? ["skin-font"] : []).sort());
        expect(el.style.getPropertyValue("--skin-surface")).toBe("#14110f");
        expect(el.style.getPropertyValue("--skin-box-text")).toBe("#f2ece0");
        expect(el.style.getPropertyValue("border-image-source")).toContain(FRAME);
        expect(el.style.getPropertyValue("border-width")).toBe("6px 8px");
        expect(document.body.classList.contains("box-edge")).toBe(false);
        expect(el.style.getPropertyValue("--skin-box-border")).toBe("");
        render(card, { skin: { ...skin, colors: { ...skin.colors, boxBorder: "#a07c40" } } });
        expect(document.body.classList.contains("box-edge")).toBe(true);
        expect(el.style.getPropertyValue("--skin-box-border")).toBe("#a07c40");
        render(card);
        expect(document.body.classList.contains("box-edge")).toBe(false);
        expect(el.style.getPropertyValue("--skin-box-border")).toBe("");
        expect(document.body.classList.contains("skinned")).toBe(false);
        expect(el.style.getPropertyValue("--skin-surface")).toBe("");
        expect(el.style.getPropertyValue("border-image-source")).toBe("");
    });

    it("never puts anything but a colour or a data: URL into the styles", () => {
        const el = render(card, { skin: { ...skin, frame: { image: 'x") ; background:url("https://example.org', slice: [1, 1, 1, 1] }, colors: { ...skin.colors, surface: "red;background:url(https://example.org)" } } });
        expect(el.style.getPropertyValue("border-image-source")).toBe("");
        expect(el.style.getPropertyValue("--skin-surface")).toBe("");
        expect(document.body.classList.contains("framed")).toBe(false);
    });

    it("finds a skin by the id the host sent it under, shows a plain card for an id it doesn't have, and forgets dropped ones", () => {
        send("tooltip:skin", 900, skin);
        render(card, { skin: 900 });
        expect(document.body.classList.contains("skinned")).toBe(true);
        render(card, { skin: 901 });
        expect(document.body.classList.contains("skinned")).toBe(false);
        send("tooltip:skin-drop", [900]);
        render(card, { skin: 900 });
        expect(document.body.classList.contains("skinned")).toBe(false);
    });

    it("lists a card's requirements last, under their heading", () => {
        const el = render({ ...card, requirements: [{ label: "Level", value: "12" }] }, { language: "de" });
        const last = el.querySelector(".item")!.lastElementChild!;
        expect(last.querySelector("small")!.textContent).toBe("Ben\u00f6tigt");
        expect(Array.from(last.querySelector(".stats")!.children).map(c => c.textContent)).toEqual(["Level", "12"]);
    });

    it("shows what a stat grows by in a third column with its heading, only when a stat of the card has it", () => {
        const levels = { ...card, perHeading: "Per level", properties: [{ label: "Damage", value: "12", per: "+3" }, { label: "Speed", value: "", per: "\u00d71.1" }, { label: "Range", value: "3" }] };
        const stats = render(levels).querySelector(".stats")!;
        expect(stats.classList.contains("has-per")).toBe(true);
        expect(Array.from(stats.children).map(c => c.textContent)).toEqual(["", "", "Per level", "Damage", "12", "+3", "Speed", "", "\u00d71.1", "Range", "3", ""]);
        expect(stats.querySelector(".per-heading")!.tagName).toBe("SMALL");
        // A heading without any per shows nothing.
        const plain = render({ ...card, perHeading: "Per level" }).querySelector(".stats")!;
        expect(plain.classList.contains("has-per")).toBe(false);
        expect(plain.querySelector(".per-heading")).toBeNull();
        // The rich layout has no third column: it follows the value.
        const rich = render({ ...levels, layout: "rich" });
        expect(Array.from(rich.querySelectorAll(".properties .value")).map(v => v.textContent)).toEqual(["12 \u00b7 +3", "\u00d71.1", "3"]);
        expect(rich.querySelector(".per-heading")).toBeNull();
    });

    it("draws the tags over the picture in its bottom corners, coloured ones in their colour, and as badges without a picture", () => {
        const tagged: TooltipContent = { ...card, badges: ["Troop"], artTags: [{ text: "Stone", side: "left" }, { text: "Legendary", color: "#e0a243" }, { text: "Odd", color: "red", side: "right" }] };
        const el = render(tagged);
        const art = el.querySelector(".card-art")!;
        expect(Array.from(art.querySelectorAll(".art-tags > div")).map(row => row.className + ": " + Array.from(row.children).map(t => t.textContent).join(", "))).toEqual(["left: Stone", "right: Legendary, Odd"]);
        const [stone, legendary, odd] = Array.from(art.querySelectorAll<HTMLElement>(".art-tag"));
        expect(stone!.getAttribute("style")).toBeNull();
        expect([legendary!.style.color, legendary!.style.borderColor]).toEqual(["rgb(224, 162, 67)", "rgb(224, 162, 67)"]);
        // A colour the host would have refused is left out here too.
        expect(odd!.getAttribute("style")).toBeNull();
        expect(Array.from(el.querySelectorAll(".name .badge")).map(b => b.textContent)).toEqual(["Troop"]);
        // Only right-hand tags: one row.
        expect(render({ ...card, artTags: [{ text: "Legendary" }] }).querySelectorAll(".art-tags > div.right")).toHaveLength(1);
        // Without a picture, and in the rich layout, their texts follow the badges, in their order.
        const { image: _image, ...bare } = tagged;
        const plain = render(bare);
        expect(plain.querySelector(".art-tags")).toBeNull();
        expect(Array.from(plain.querySelectorAll(".name .badge")).map(b => b.textContent)).toEqual(["Troop", "Stone", "Legendary", "Odd"]);
        const rich = render({ ...tagged, layout: "rich" });
        expect(rich.querySelector(".art-tags")).toBeNull();
        expect(Array.from(rich.querySelectorAll(".heading .badge")).map(b => b.textContent)).toEqual(["Troop", "Stone", "Legendary", "Odd"]);
        // The unit layout leaves them out, like the badges.
        const unit = render({ ...tagged, layout: "unit" });
        expect(unit.querySelector(".art-tags, .badge")).toBeNull();
    });

    it("draws a \u2013 in an extra column faint, and nothing else", () => {
        const stats = render({ ...card, columns: ["Lv 1", "Lv 2", "Lv 3"], properties: [{ label: "Units", value: "6", more: ["\u2013", "12"] }, { label: "Range", value: "3", more: ["-", "\u2013 1"] }] }).querySelector(".stats")!;
        expect(Array.from(stats.querySelectorAll(".more")).map(c => c.className)).toEqual(["more faint", "more", "more", "more"]);
    });

    it("shows a stat's extra values in columns of their own under their headings, before what it grows by", () => {
        const levels: TooltipContent = { ...card, columns: ["Lv 1", "Lv 2", "Lv 3"], perHeading: "Per level", properties: [{ label: "Units", value: "6", more: ["12", "18"] }, { label: "Attack speed", value: "0.6" }, { label: "Damage", value: "6", more: ["", "8.6"], per: "+1" }] };
        const stats = render(levels).querySelector<HTMLElement>(".stats")!;
        expect(stats.className).toBe("stats has-per has-columns");
        expect(stats.style.getPropertyValue("--stat-columns")).toBe("4");
        expect(Array.from(stats.children).map(c => c.textContent)).toEqual(["", "Lv 1", "Lv 2", "Lv 3", "Per level", "Units", "6", "12", "18", "", "Attack speed", "0.6", "", "", "", "Damage", "6", "", "8.6", "+1"]);
        expect(Array.from(stats.querySelectorAll(".per-heading")).map(h => h.tagName)).toEqual(["SMALL", "SMALL", "SMALL", "SMALL"]);
        expect(Array.from(stats.querySelectorAll(".more")).map(c => c.textContent)).toEqual(["12", "18", "", "", "", "8.6"]);
        // Without columns there is no heading row; without any per no per column.
        const bare = render({ ...card, properties: [{ label: "Units", value: "6", more: ["12", "18"] }, { label: "Range", value: "3" }] }).querySelector<HTMLElement>(".stats")!;
        expect(bare.className).toBe("stats has-columns");
        expect(bare.style.getPropertyValue("--stat-columns")).toBe("3");
        expect(Array.from(bare.children).map(c => c.textContent)).toEqual(["Units", "6", "12", "18", "Range", "3", "", ""]);
        // A per heading without columns sits over the per column, after the extra ones.
        const per = render({ ...card, perHeading: "Per level", properties: [{ label: "Units", value: "6", more: ["12"], per: "+6" }] }).querySelector(".stats")!;
        expect(Array.from(per.children).map(c => c.textContent)).toEqual(["", "", "", "Per level", "Units", "6", "12", "+6"]);
        // The rich layout follows the value with them: an empty one in between as a dash, empty ones at the end left out.
        const rich = render({ ...levels, layout: "rich", properties: [...levels.properties!, { label: "Shield", value: "", more: ["", "4", " "] }] });
        expect(Array.from(rich.querySelectorAll(".properties .value")).map(v => v.textContent)).toEqual(["6 · 12 · 18", "0.6", "6 · – · 8.6 · +1", "– · – · 4"]);
        expect(rich.querySelector(".per-heading")).toBeNull();
    });

    it("draws a stat's icon before its label as a mask, and keeps its room on every label when only some have one", () => {
        const HEART = "data:image/png;base64,iVBORw0KGgo=";
        const stats = render({ ...card, perHeading: "Per level", properties: [{ label: "HP", value: "40", icon: HEART }, { label: "Damage", value: "12", per: "+3", icon: "data:image/webp;base64,UklGRg==" }, { label: "Range", value: "3" }] }).querySelector(".stats")!;
        expect(stats.className).toBe("stats has-per has-icons");
        const labels = Array.from(stats.querySelectorAll(".stats-label"));
        // The label's text stays its name; the icon is decoration.
        expect(labels.map(l => l.textContent)).toEqual(["HP", "Damage", "Range"]);
        const icons = labels.map(l => l.firstElementChild as HTMLElement);
        expect(icons.map(i => i.className)).toEqual(["stat-icon drawn", "stat-icon drawn", "stat-icon"]);
        expect(icons.every(i => i.getAttribute("aria-hidden") === "true" && !i.textContent)).toBe(true);
        expect(icons[0]!.style.getPropertyValue("--stat-icon")).toBe(`url("${HEART}")`);
        expect(icons[2]!.style.getPropertyValue("--stat-icon")).toBe("");
        expect(Array.from(stats.children).map(c => c.textContent)).toEqual(["", "", "Per level", "HP", "40", "", "Damage", "12", "+3", "Range", "3", ""]);
        // Without any icon the labels are plain text, as before.
        const plain = render(card).querySelector(".stats")!;
        expect(plain.className).toBe("stats");
        expect(plain.querySelector(".stat-icon")).toBeNull();
    });

    it("never puts anything but a checked picture into an icon's style", () => {
        const stats = render({ ...card, properties: [{ label: "A", value: "1", icon: 'data:image/png;base64,AA=="),url(https://example.org/x' }, { label: "B", value: "2", icon: "dist/icons/heart.png" }, { label: "C", value: "3", icon: "data:image/svg+xml;base64,PHN2Zz4=" }, { label: "D", value: "4", icon: "data:image/jpeg;base64,/9j/4AA=" }, { label: "E", value: "5", icon: "data:image/gif;base64,R0lGODlh" }] }).querySelector(".stats")!;
        for (const icon of Array.from(stats.querySelectorAll<HTMLElement>(".stat-icon"))) {
            expect(icon.classList.contains("drawn")).toBe(false);
            expect(icon.getAttribute("style")).toBeNull();
        }
    });

    it("shows no icons in the rich layout", () => {
        const rich = render({ ...card, layout: "rich", properties: [{ label: "HP", value: "40", icon: "data:image/png;base64,iVBORw0KGgo=" }] });
        expect(rich.querySelector(".stat-icon")).toBeNull();
        expect(rich.querySelector(".properties")!.textContent).toBe("HP: 40");
    });

    const PNG = "data:image/png;base64,iVBORw0KGgo=";
    const unit: TooltipContent = {
        title: "Soldier",
        layout: "unit",
        image: PNG,
        badges: ["Rare"],
        requirements: [{ label: "Level", value: "3" }],
        corner: { text: "1800", icon: PNG },
        effect: [{ text: "Gains " }, { text: "+1%", accent: true }, { text: " damage per unit." }],
        properties: [{ label: "Health:", value: "3.95", suffix: "E+12" }, { label: "Hits/Second:", value: "99.999", suffix: " (MAX)" }, { label: "Crit Chance:", value: "5%", per: "+1", icon: PNG }],
        icons: [{ image: PNG, label: "Steel Coat", count: "95" }, { image: "", label: "Static" }],
        pips: { filled: 2, total: 3, extra: "+67" },
    };

    it("lays a unit out: the portrait, the title bar with its corner value, then effect, stats, icon row and pips", () => {
        const el = render(unit);
        expect(document.body.classList.contains("unit")).toBe(true);
        expect(document.body.classList.contains("card")).toBe(false);
        const u = el.querySelector(".u-card")!;
        expect(u.className).toBe("u-card has-pips has-extra");
        expect(Array.from(u.children).map(c => c.className)).toEqual(["u-portrait", "u-bar", "u-body"]);
        expect(u.querySelector(".u-portrait img")!.getAttribute("src")).toBe(PNG);
        expect(u.querySelector(".u-bar h2")!.textContent).toBe("Soldier");
        expect(u.querySelector(".u-corner")!.textContent).toBe("1800");
        const icon = u.querySelector<HTMLElement>(".u-corner-icon")!;
        expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(icon.style.getPropertyValue("--u-icon")).toBe(`url("${PNG}")`);
        const body = u.querySelector(".u-body")!;
        expect(Array.from(body.children).map(c => c.className)).toEqual(["u-effect", "u-stats", "u-icons", "u-pips", "u-extra"]);
        expect(Array.from(body.querySelectorAll(".u-effect .accent")).map(a => a.textContent)).toEqual(["+1%"]);
        // Three columns: label, value, and the suffix kept as given (a leading space too); no per or icon here.
        expect(Array.from(body.querySelector(".u-stats")!.children).map(c => c.className + "=" + c.textContent)).toEqual(["u-label=Health:", "u-value=3.95", "u-suffix=E+12", "u-label=Hits/Second:", "u-value=99.999", "u-suffix= (MAX)", "u-label=Crit Chance:", "u-value=5%", "u-suffix="]);
        expect(body.querySelector(".stat-icon, .per")).toBeNull();
        // Each picture has its name (with its count) for screen readers; one the host couldn't read leaves an empty frame.
        const frames = Array.from(body.querySelectorAll(".u-icon"));
        expect(frames.map(f => f.getAttribute("role") + ":" + f.getAttribute("aria-label"))).toEqual(["img:Steel Coat (95)", "img:Static"]);
        expect(frames[0]!.querySelector("img")!.getAttribute("src")).toBe(PNG);
        expect(frames[0]!.querySelector(".u-count")!.textContent).toBe("95");
        expect(frames[1]!.children).toHaveLength(0);
        const pips = body.querySelector(".u-pips")!;
        expect(Array.from(pips.children).map(p => p.className)).toEqual(["u-pip on", "u-pip on", "u-pip"]);
        expect(pips.getAttribute("aria-label")).toBe("2 / 3 +67");
        expect(body.querySelector(".u-extra")!.textContent).toBe("+67");
        // Badges and requirements aren't part of a unit; the footer still says whose card it is.
        expect(el.querySelector(".badge, .card-requirements, .requirements")).toBeNull();
        expect(el.querySelector(".footer")!.textContent).toContain("9 Kings");
    });

    it("leaves out what a unit doesn't have, and puts the close button of a pinned one in its title bar", () => {
        const el = render({ title: "Thief", layout: "unit", properties: [{ label: "Health:", value: "18.8" }] }, { pinned: true });
        const u = el.querySelector(".u-card")!;
        expect(u.className).toBe("u-card no-portrait");
        expect(u.querySelector(".u-portrait, .u-corner, .u-icons, .u-pips, .u-extra, .u-effect")).toBeNull();
        expect(Array.from(u.querySelector(".u-bar")!.children).map(c => c.tagName.toLowerCase() + (c.id ? "#" + c.id : ""))).toEqual(["h2", "button#close"]);
        expect(el.querySelector(":scope > #close")).toBeNull();
    });

    it("dresses a unit in its skin's colours, bar, font and hard pixels, but no frame", () => {
        const el = render(unit, { skin: { ...skin, colors: { ...skin.colors, bar: "#776538" } } });
        expect(document.body.classList.contains("unit")).toBe(true);
        expect(document.body.classList.contains("skin-colors")).toBe(true);
        expect(document.body.classList.contains("pixel")).toBe(true);
        expect(document.body.classList.contains("framed")).toBe(false);
        expect(el.style.getPropertyValue("--skin-bar")).toBe("#776538");
        expect(el.style.getPropertyValue("border-image-source")).toBe("");
        render(unit, { skin });
        expect(el.style.getPropertyValue("--skin-bar")).toBe("");
    });

    it("never puts anything but a checked picture into a unit's styles or pictures, and never takes the PoE look", () => {
        const bad = 'data:image/png;base64,AA=="),url(https://example.org/x';
        const el = render({ ...unit, look: "poe", corner: { text: "3", icon: bad }, icons: [{ image: "https://example.org/x.png", label: "A" }, { image: "data:image/svg+xml;base64,PHN2Zz4=", label: "B" }] });
        expect(document.body.classList.contains("poe")).toBe(false);
        expect(el.querySelector(".u-corner-icon")).toBeNull();
        expect(el.querySelectorAll(".u-icon img")).toHaveLength(0);
    });

    it("puts a suffix into the value in the card and rich layouts", () => {
        const properties = [{ label: "Health", value: "3.95", suffix: "E+12" }];
        expect(Array.from(render({ ...card, properties }).querySelector(".stats")!.children).map(c => c.textContent)).toEqual(["Health", "3.95E+12"]);
        expect(render({ title: "A", properties }).querySelector(".properties")!.textContent).toBe("Health: 3.95E+12");
    });

    it("shows the rich layout as before, with no skin even when one is sent", () => {
        const el = render({ ...card, layout: "rich" }, { skin });
        expect(document.body.classList.contains("card")).toBe(false);
        expect(document.body.classList.contains("skinned")).toBe(false);
        expect(el.querySelector("#layout .art img")).not.toBeNull();
        expect(el.querySelector(".details .heading h2")!.textContent).toBe("Archer Tower");
        expect(el.querySelector(".details .effect")!.textContent).toBe("Shoots for 12 damage");
        const plain = render({ title: "Bow", sections: [{ rows: [{ text: "Adds 1 to 2" }] }] });
        expect(plain.querySelector(".effect")).toBeNull();
        expect(plain.querySelector("section li .text")!.textContent).toBe("Adds 1 to 2");
    });

    const formatted: TooltipContent = {
        title: "Multi Shot",
        effect: [{ text: "Shooting " }, { text: "Regular Arrows", italic: true }, { text: " has a " }, { text: "20%", accent: true, strong: true }, { text: " chance.\n\nMore." }],
        sections: [{ rows: [{ text: "Affix" }] }],
        blocks: [
            { type: "text", runs: [{ text: "A flavour line", italic: true }], tone: "muted", size: "small" },
            { type: "text", text: "<b>In a box</b>", box: true },
            { type: "heading", text: "Found in" },
            { type: "list", items: ["Spire", { text: "Shroud", meta: "Rare" }] },
            { type: "tags", tags: ["Stone", { text: "Legendary", color: "#e0a243" }, { text: "Odd", color: "red" }] },
        ],
        footer: [{ text: "Skill points: ", strong: true }, { text: "3" }],
    };
    /** A part as a short line: its tag, its kit class and data attributes, and its markup inside. */
    const describePart = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}${Array.from(el.attributes).filter(a => a.name.startsWith("data-")).map(a => `[${a.name}=${a.value}]`).join("")} ${el.innerHTML}`;

    it("draws bold and italic runs in the effect as the kit does, and keeps them text", () => {
        const effect = render(formatted).querySelector(".effect")!;
        expect(effect.innerHTML).toBe('Shooting <em>Regular Arrows</em> has a <span class="accent"><strong>20%</strong></span> chance.\n\nMore.');
    });

    it("draws the blocks after the sections in the kit parts' markup, and the footer above Tavora's own", () => {
        for (const layout of ["rich", "card"] as const) {
            const el = render({ ...formatted, layout });
            const parts = Array.from(el.querySelectorAll(".tavora-tooltip-text, .tavora-tooltip-heading, .tavora-tooltip-list, .tavora-tooltip-tags"));
            expect(parts.map(describePart)).toEqual([
                "p.tavora-tooltip-text[data-tone=muted][data-size=small] <em>A flavour line</em>",
                "p.tavora-tooltip-text[data-box=] &lt;b&gt;In a box&lt;/b&gt;",
                "h4.tavora-tooltip-heading Found in",
                "ul.tavora-tooltip-list <li><span>Spire</span></li><li><span>Shroud</span><span>Rare</span></li>",
                'ul.tavora-tooltip-tags <li class="tavora-tooltip-badge">Stone</li><li class="tavora-tooltip-badge" style="color: rgb(224, 162, 67); border-color: rgb(224, 162, 67);">Legendary</li><li class="tavora-tooltip-badge">Odd</li>',
            ]);
            // After the sections, in the same column.
            expect(parts[0]!.previousElementSibling!.tagName).toBe("SECTION");
            const footer = el.querySelector("footer.tavora-tooltip-footer")!;
            expect(footer.innerHTML).toBe("<strong>Skill points: </strong>3");
            expect(footer.parentElement).toBe(el);
            expect(footer.nextElementSibling!.className).toBe("footer");
        }
    });

    it("draws a unit's blocks after its sections and its footer at the end of its body", () => {
        const el = render({ ...formatted, layout: "unit", footer: "Corrupted" });
        const body = el.querySelector(".u-body")!;
        expect(Array.from(body.children).map(c => c.className)).toEqual(["u-effect", "", "tavora-tooltip-text", "tavora-tooltip-text", "tavora-tooltip-heading", "tavora-tooltip-list", "tavora-tooltip-tags", "tavora-tooltip-footer"]);
        expect(body.querySelector(".tavora-tooltip-footer")!.textContent).toBe("Corrupted");
    });

    it("draws neither without them", () => {
        const el = render(card);
        expect(el.querySelector("[class^=tavora-tooltip]")).toBeNull();
    });
});

// The window comes into sight once, at the card's final size: the page says which size is final, and when it drew there.
describe("tooltip preload sizes", () => {
    const sizes = () => ipc.sent.filter(m => m[0] === "tooltip:size");
    it("measures at once, then again as final once its pictures and letters are in", async () => {
        ipc.sent.length = 0;
        render(card);
        expect(sizes().map(m => m[4])).toEqual([false]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(sizes().map(m => m[4])).toEqual([false, true]);
        expect(sizes().every(m => m[1] === serial)).toBe(true);
    });
    it("sends no final size for a card already replaced by the next", async () => {
        ipc.sent.length = 0;
        render(card);
        const first = serial;
        render({ ...card, title: "Next" });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(sizes().filter(m => m[4] === true).map(m => m[1])).toEqual([serial]);
        expect(serial).not.toBe(first);
    });
    it("keeps the card in sight until the window is placed for the next one, and sends only the next one's final size", async () => {
        render(card);
        await new Promise(resolve => setTimeout(resolve, 0));
        ipc.sent.length = 0;
        const el = render({ ...card, title: "Next" }, { keep: true });
        expect(el.querySelector("h2")!.textContent).toBe("Archer Tower");
        expect(sizes()).toEqual([]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(sizes().map(m => [m[1], m[4]])).toEqual([[serial, true]]);
        expect(el.querySelector("h2")!.textContent).toBe("Archer Tower");
        // A late font or picture doesn't move the window while the card waits.
        document.fonts?.dispatchEvent(new Event("loadingdone"));
        expect(sizes()).toHaveLength(1);
        send("tooltip:placed", serial);
        expect(el.querySelector("h2")!.textContent).toBe("Next");
    });
    it("says it drew once a frame is on screen after the window was placed, for the current card only", async () => {
        render(card);
        ipc.sent.length = 0;
        send("tooltip:placed", serial - 1);
        send("tooltip:placed", serial);
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(ipc.sent.filter(m => m[0] === "tooltip:drawn")).toEqual([["tooltip:drawn", serial]]);
    });
});
