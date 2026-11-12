import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSkinRequest, contrast, MAX_SKIN_FILE, MAX_SKINS, SkinStore } from "./tooltip-skin";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]);
const WOFF2 = Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(40)]);
const good = { frame: { image: "dist/frame.png", slice: [6, 6, 6, 6] }, colors: { surface: "#14110f", text: "#f2ece0", muted: "#b8ad9c", accent: "#e8b04a", box: "#231d18", boxText: "#f2ece0" }, font: "dist/fonts/card.woff2", pixelArt: true, titleCaps: true };

let root: string;
let outside: string;
beforeAll(async () => {
    const base = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-skin-")));
    root = path.join(base, "module");
    outside = path.join(base, "other");
    await mkdir(path.join(root, "dist", "fonts"), { recursive: true });
    await mkdir(path.join(outside, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "frame.png"), PNG);
    await writeFile(path.join(root, "dist", "frame.webp"), WEBP);
    await writeFile(path.join(root, "dist", "fonts", "card.woff2"), WOFF2);
    await writeFile(path.join(root, "dist", "fake.png"), WOFF2);
    await writeFile(path.join(root, "dist", "fake.woff2"), PNG);
    await writeFile(path.join(root, "dist", "big.png"), Buffer.concat([PNG, Buffer.alloc(MAX_SKIN_FILE)]));
    await writeFile(path.join(outside, "dist", "frame.png"), PNG);
    await writeFile(path.join(root, "dist", "frame-b.png"), Buffer.concat([PNG, Buffer.alloc(2000)]));
    // A folder link (a junction on Windows, which needs no rights) and a file link out of the bundle.
    await symlink(path.join(outside, "dist"), path.join(root, "dist", "linked"), "junction");
    try {
        await symlink(path.join(outside, "dist", "frame.png"), path.join(root, "dist", "escape.png"), "file");
        fileLink = true;
    }
    catch { /* Windows without the right to make file links: the junction covers it. */ }
});
let fileLink = false;

const define = async (skin: unknown, name = "progress") => (await new SkinStore().define("m", root, name, checkSkinRequest({ name, skin }).skin))!.stored.skin;

describe("item-card skins", () => {
    it("takes a good skin and reads its files in as data: URLs", async () => {
        const skin = await define(good);
        expect(skin.frame).toEqual({ image: "data:image/png;base64," + PNG.toString("base64"), slice: [6, 6, 6, 6] });
        expect(skin.font).toBe("data:font/woff2;base64," + WOFF2.toString("base64"));
        expect(skin.colors).toEqual(good.colors);
        expect(skin).toMatchObject({ pixelArt: true, titleCaps: true });
        expect((await define({ frame: { image: "dist/frame.webp", slice: [0, 4, 0, 4] } })).frame!.image).toMatch(/^data:image\/webp;base64,/);
    });

    it("fills in the colours left out and takes a skin without colours", async () => {
        expect((await define({ colors: { surface: "#000000", text: "#FFFFFF" } })).colors).toEqual({ surface: "#000000", text: "#ffffff", muted: "#ffffff", accent: "#ffffff", box: "#000000", boxText: "#ffffff" });
        expect(await define({ titleCaps: true })).toEqual({ pixelArt: false, titleCaps: true });
    });

    it("takes an edge for the effect box that stands out from the box by 3:1, and refuses one that doesn't", async () => {
        const colors = { surface: "#1e1610", text: "#f4e6c8", box: "#2c2016" };
        expect((await define({ colors: { ...colors, boxBorder: "#A07C40" } })).colors!.boxBorder).toBe("#a07c40");
        expect("boxBorder" in (await define({ colors })).colors!).toBe(false);
        await expect(define({ colors: { ...colors, boxBorder: "#3a2c20" } })).rejects.toMatchObject({ code: "INVALID_PARAMS", message: expect.stringMatching(/colors.boxBorder on colors.box is too hard to see .*needs 3:1/) });
        expect(() => checkSkinRequest({ name: "a", skin: { colors: { ...colors, boxBorder: "#abc" } } })).toThrow(/colors.boxBorder/);
    });

    it("refuses a colour that isn't #rrggbb", async () => {
        for (const surface of ["#fff", "red", "rgb(0,0,0)", "#12345g", "#1234567", "#000000;x:y", 0])
            expect(() => checkSkinRequest({ name: "a", skin: { colors: { surface, text: "#ffffff" } } })).toThrow(/colors.surface/);
        await expect(define({ colors: { text: "#ffffff" } })).rejects.toThrow(/surface and text/);
    });

    it("refuses colours that are hard to read, and says which pair", async () => {
        expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
        await expect(define({ colors: { surface: "#202020", text: "#555555" } })).rejects.toMatchObject({ code: "INVALID_PARAMS", message: expect.stringMatching(/colors.text on colors.surface .*needs 4.5:1/) });
        await expect(define({ colors: { surface: "#101010", text: "#f0f0f0", muted: "#505050" } })).rejects.toThrow(/colors.muted on colors.surface/);
        await expect(define({ colors: { surface: "#101010", text: "#f0f0f0", box: "#d0d0d0" } })).rejects.toThrow(/colors.boxText on colors.box/);
        // The accent in the effect box is text (numbers): 4.5:1 there; on the surface it is only a line: 3:1.
        await expect(define({ colors: { surface: "#101010", text: "#f0f0f0", accent: "#707070" } })).rejects.toThrow(/colors.accent on colors.box .*needs 4.5:1/);
        await expect(define({ colors: { surface: "#101010", text: "#f0f0f0", box: "#f0f0f0", boxText: "#101010", accent: "#505050" } })).rejects.toThrow(/colors.accent on colors.surface .*needs 3:1/);
        await expect(define({ colors: { surface: "#101010", text: "#f0f0f0", box: "#f0f0f0", boxText: "#101010", accent: "#e0e0e0" } })).rejects.toThrow(/colors.accent on colors.box/);
        expect((await define({ colors: { surface: "#101010", text: "#f0f0f0", box: "#f0f0f0", boxText: "#101010", accent: "#606060" } })).colors!.accent).toBe("#606060");
    });

    it("refuses files that aren't what they say by their first bytes", async () => {
        await expect(define({ frame: { image: "dist/fake.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/isn't a PNG or WebP picture/);
        await expect(define({ font: "dist/fake.woff2" })).rejects.toThrow(/isn't a WOFF2 font/);
    });

    it("refuses a file over 512 KB", async () => {
        await expect(define({ frame: { image: "dist/big.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/larger than 512 KB/);
    });

    it("reads files only from the module's own dist folder", async () => {
        for (const image of ["dist/../../other/dist/frame.png", "../other/dist/frame.png", "/etc/frame.png", "https://example.org/frame.png", "file:///C:/frame.png", "src/frame.png", "dist/frame.svg", "dist\\frame.png"])
            expect(() => checkSkinRequest({ name: "a", skin: { frame: { image, slice: [1, 1, 1, 1] } } })).toThrow(/frame.image/);
        expect(() => checkSkinRequest({ name: "a", skin: { font: "dist/card.ttf" } })).toThrow(/font/);
        await expect(define({ frame: { image: "dist/missing.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/isn't a file in your module/);
    });

    it("refuses a file reached through a link or junction that leads out of the bundle", async () => {
        await expect(define({ frame: { image: "dist/linked/frame.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/isn't a file in your module/);
        if (fileLink)
            await expect(define({ frame: { image: "dist/escape.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/isn't a file in your module/);
    });

    it("refuses a bad name, unknown keys and slices out of range", () => {
        for (const name of ["", "Progress", "a b", "a_b", "x".repeat(33), 3, undefined])
            expect(() => checkSkinRequest({ name, skin: {} })).toThrow(/name/);
        expect(() => checkSkinRequest({ name: "a", skin: { css: "body{}" } })).toThrow(/unknown key "css"/);
        expect(() => checkSkinRequest({ name: "a", skin: { colors: { background: "#000000" } } })).toThrow(/unknown key/);
        for (const slice of [[1, 1, 1], [1, 1, 1, 65], [1, 1, 1, -1], [1, 1, 1, 1.5], "1 1 1 1"])
            expect(() => checkSkinRequest({ name: "a", skin: { frame: { image: "dist/frame.png", slice } } })).toThrow(/slice/);
        expect(() => checkSkinRequest({ name: "a", skin: { pixelArt: "yes" } })).toThrow(/pixelArt/);
    });

    it("keeps at most 32 skins per module, and replaces one by its name", async () => {
        const store = new SkinStore();
        for (let i = 0; i < MAX_SKINS; i++)
            await store.define("local.kings", root, "skin-" + i, { titleCaps: false });
        await expect(store.define("local.kings", root, "one-more", {})).rejects.toMatchObject({ code: "INVALID_PARAMS", message: expect.stringMatching(/at most 32/) });
        await store.define("local.kings", root, "skin-3", { titleCaps: true });
        expect(store.get("local.kings", "skin-3")!.skin).toMatchObject({ titleCaps: true });
        await store.define("local.other", root, "one-more", {});
        expect(store.get("local.other", "one-more")).toBeDefined();
        expect(store.get("local.kings", "one-more")).toBeUndefined();
    });

    it("keeps a file once for all skins that use it, and lets go of it with the last one", async () => {
        const store = new SkinStore();
        const a = (await store.define("m", root, "a", { frame: { image: "dist/frame.png", slice: [1, 1, 1, 1] } }))!.stored;
        const b = (await store.define("other", root, "b", { frame: { image: "dist/frame.png", slice: [2, 2, 2, 2] } }))!.stored;
        expect(b.skin.frame!.image).toBe(a.skin.frame!.image);
        expect(b.files[0]).toBe(a.files[0]);
        expect(b.id).not.toBe(a.id);
        expect(store.forgetModule("m")).toEqual([a.id]);
        expect(store.get("m", "a")).toBeUndefined();
        expect(store.get("other", "b")).toBe(b);
    });

    it("refuses a skin that would take the skin files of all modules over the cap", async () => {
        const one = "data:image/png;base64,".length + Math.ceil(PNG.length / 3) * 4;
        const store = new SkinStore(one + 100);
        await store.define("m", root, "a", { frame: { image: "dist/frame.png", slice: [1, 1, 1, 1] } });
        // The same file again costs nothing; another file goes over.
        await store.define("n", root, "a", { frame: { image: "dist/frame.png", slice: [1, 1, 1, 1] } });
        await expect(store.define("n", root, "b", { frame: { image: "dist/frame-b.png", slice: [1, 1, 1, 1] } })).rejects.toMatchObject({ code: "INVALID_PARAMS", message: expect.stringMatching(/at most .* MB of skin files/) });
        // Replacing a skin frees what it used.
        store.forgetModule("n");
        await expect(store.define("m", root, "a", { frame: { image: "dist/frame-b.png", slice: [1, 1, 1, 1] } })).rejects.toThrow(/MB of skin files/);
        await store.define("m", root, "a", { titleCaps: true });
        expect(store.get("m", "a")!.files).toEqual([]);
    });

    it("lets the later of two defines of one name win, and drops a define that a forget overtook", async () => {
        const store = new SkinStore();
        const first = store.define("m", root, "a", { frame: { image: "dist/frame.png", slice: [1, 1, 1, 1] } });
        const second = store.define("m", root, "a", { titleCaps: true });
        expect(await second).toBeDefined();
        expect(await first).toBeUndefined();
        expect(store.get("m", "a")!.skin).toEqual({ pixelArt: false, titleCaps: true });
        const late = store.define("m", root, "b", { frame: { image: "dist/frame.png", slice: [1, 1, 1, 1] } });
        store.forgetModule("m");
        expect(await late).toBeUndefined();
        expect(store.get("m", "b")).toBeUndefined();
    });

    it("keeps nothing of a skin that was refused", async () => {
        const store = new SkinStore();
        await store.define("m", root, "a", { titleCaps: true });
        await expect(store.define("m", root, "a", { font: "dist/fake.woff2" })).rejects.toThrow();
        expect(store.get("m", "a")!.skin).toMatchObject({ titleCaps: true });
    });
});
