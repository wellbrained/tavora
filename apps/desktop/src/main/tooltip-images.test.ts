import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ICON_BYTES, withBundleImages } from "./tooltip-images";

// The tooltip page loads nothing but data: URLs: the host reads the card's pictures from the module's bundle first.
let root = "";
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const url = (bytes: Buffer, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;
beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-tooltip-images-")));
    await mkdir(path.join(root, "dist", "icons"), { recursive: true });
    await writeFile(path.join(root, "dist", "art.png"), PNG);
    await writeFile(path.join(root, "dist", "icons", "heart.png"), PNG);
    await writeFile(path.join(root, "dist", "icons", "sword.webp"), PNG);
    await writeFile(path.join(root, "dist", "icons", "huge.png"), Buffer.alloc(ICON_BYTES + 1));
});

describe("withBundleImages", () => {
    it("reads the picture and each stat's icon of a card as data: URLs", async () => {
        const content = await withBundleImages(root, { title: "A", layout: "card", image: "dist/art.png", properties: [{ label: "HP", value: "40", icon: "dist/icons/heart.png" }, { label: "Damage", value: "12", icon: "dist/icons/sword.webp" }, { label: "Armor", value: "2", icon: "dist/icons/heart.png" }, { label: "Range", value: "3" }] });
        expect(content.image).toBe(url(PNG));
        expect(content.properties).toEqual([{ label: "HP", value: "40", icon: url(PNG) }, { label: "Damage", value: "12", icon: url(PNG, "image/webp") }, { label: "Armor", value: "2", icon: url(PNG) }, { label: "Range", value: "3" }]);
    });

    it("leaves out an icon that is missing or too large, and keeps the stat", async () => {
        const content = await withBundleImages(root, { title: "A", layout: "card", image: "dist/gone.png", properties: [{ label: "HP", value: "40", icon: "dist/icons/gone.png" }, { label: "Damage", value: "12", icon: "dist/icons/huge.png" }] });
        expect(content).toEqual({ title: "A", layout: "card", properties: [{ label: "HP", value: "40" }, { label: "Damage", value: "12" }] });
    });

    it("drops the icons unread on the rich layout, which doesn't show them", async () => {
        const content = await withBundleImages(root, { title: "A", properties: [{ label: "HP", value: "40", icon: "dist/icons/heart.png" }] });
        expect(content.properties).toEqual([{ label: "HP", value: "40" }]);
    });
});
