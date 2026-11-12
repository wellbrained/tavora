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
        render(card);
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
});
