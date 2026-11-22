import { readFile, stat } from "node:fs/promises";
import type { TooltipContent } from "@tavora/sdk/protocol";
import { contentTypeFor, resolveAsset } from "./assets";
/** The item picture may be up to 512 KB; a stat's icon is a small pictogram and gets 64 KB. */
export const IMAGE_BYTES = 512000, ICON_BYTES = 65536;
/**
 * A picture from the module's bundle (a path tooltip-content.ts checked) as a data: URL, or nothing when it is missing,
 * leads out of the bundle, can't be read or is larger than `max` bytes.
 */
export async function bundleImage(root: string, path: string, max: number): Promise<string | undefined> {
    try {
        const file = await resolveAsset(root, "/" + path);
        if (file && (await stat(file)).size <= max) {
            const bytes = await readFile(file);
            if (bytes.length <= max)
                return `data:${contentTypeFor(file)};base64,${bytes.toString("base64")}`;
        }
    }
    catch { /* Missing artwork leaves the text intact. */ }
    return undefined;
}
/**
 * The card's pictures read in, since the tooltip page loads nothing but data: URLs: the item picture, on the card
 * layout each stat's icon, and on the unit layout the corner's icon and the icon row's pictures (each file once). One
 * that can't be read is left out and the text stays (an icon row's picture leaves an empty frame, `image: ""`); a
 * layout that doesn't show a picture gets it unread, and no icon row.
 */
export async function withBundleImages(root: string, content: TooltipContent): Promise<TooltipContent> {
    const { image: path, corner, icons: row, ...rest } = content;
    const image = path ? await bundleImage(root, path, IMAGE_BYTES) : undefined;
    const out: TooltipContent = { ...rest, ...(image ? { image } : {}) };
    const card = content.layout === "card", unit = content.layout === "unit";
    const read = new Map<string, Promise<string | undefined>>();
    const icon = (path: string) => { let url = read.get(path); if (!url)
        read.set(path, url = bundleImage(root, path, ICON_BYTES)); return url; };
    if (content.properties?.some(p => p.icon !== undefined))
        out.properties = await Promise.all(content.properties.map(async ({ icon: path, ...p }) => { const url = card && path !== undefined ? await icon(path) : undefined; return url ? { ...p, icon: url } : p; }));
    if (corner) {
        const { icon: path, ...text } = corner, url = unit && path !== undefined ? await icon(path) : undefined;
        out.corner = url ? { ...text, icon: url } : text;
    }
    if (row && unit)
        out.icons = await Promise.all(row.map(async ({ image: path, ...i }) => ({ ...i, image: (await icon(path)) ?? "" })));
    return out;
}
