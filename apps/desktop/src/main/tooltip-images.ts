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
 * The card's pictures read in, since the tooltip page loads nothing but data: URLs: the item picture, and on the card
 * layout each stat's icon (each file once). One that can't be read is left out and the text stays; the rich layout
 * shows no icons, so they go there unread.
 */
export async function withBundleImages(root: string, content: TooltipContent): Promise<TooltipContent> {
    const { image: path, ...rest } = content;
    const image = path ? await bundleImage(root, path, IMAGE_BYTES) : undefined;
    const out: TooltipContent = { ...rest, ...(image ? { image } : {}) };
    if (!content.properties?.some(p => p.icon !== undefined))
        return out;
    const icons = new Map<string, Promise<string | undefined>>();
    const icon = (path: string) => { let read = icons.get(path); if (!read)
        icons.set(path, read = bundleImage(root, path, ICON_BYTES)); return read; };
    const card = content.layout === "card";
    out.properties = await Promise.all(content.properties.map(async ({ icon: path, ...p }) => { const url = card && path !== undefined ? await icon(path) : undefined; return url ? { ...p, icon: url } : p; }));
    return out;
}
