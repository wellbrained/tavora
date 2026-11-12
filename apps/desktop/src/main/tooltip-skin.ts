import { readFile, stat } from "node:fs/promises";
import type { TooltipSkin } from "@tavora/sdk/protocol";
import { resolveAsset } from "./assets";
import { HostError } from "./errors";

/**
 * Item-card skins (`ui.tooltip.defineSkin`): a module's own frame, colours and title font for its cards in the shared
 * tooltip. A skin is a set of checked values, never CSS. Its files come from the module's own bundle, like a tooltip's
 * `image`, and are checked by their first bytes; its colours must be readable. A skin that fails is refused with the
 * reason and never shown.
 */
export const SKIN_NAME = /^[a-z0-9-]{1,32}$/;
export const MAX_SKINS = 32;
/** The most a frame picture or a font may weigh, as for a tooltip's picture. */
export const MAX_SKIN_FILE = 512000;
const MAX_SLICE = 64;
const HEX = /^#[0-9a-fA-F]{6}$/;
const PATH = (ext: string) => new RegExp(`^dist\\/(?:[a-zA-Z0-9_. -]+\\/)*[a-zA-Z0-9_. -]+\\.(?:${ext})$`, "i");
const FRAME_PATH = PATH("png|webp");
const FONT_PATH = PATH("woff2");
const COLOR_KEYS = ["surface", "text", "muted", "accent", "box", "boxText"] as const;

export type SkinColors = Record<(typeof COLOR_KEYS)[number], string>;

/** A checked skin with its files read in as data: URLs, as the tooltip window gets it. */
export interface ResolvedSkin {
    frame?: { image: string; slice: [number, number, number, number] };
    colors?: SkinColors;
    font?: string;
    pixelArt: boolean;
    titleCaps: boolean;
}

function refuse(message: string): never {
    throw new HostError("INVALID_PARAMS", `ui.tooltip.defineSkin: ${message}`);
}

function record(v: unknown, keys: readonly string[], what: string): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v))
        refuse(`${what} must be an object`);
    const o = v as Record<string, unknown>;
    const unknown = Object.keys(o).find(k => !keys.includes(k));
    if (unknown !== undefined)
        refuse(`${what} has an unknown key "${unknown}"`);
    return o;
}

function bundlePath(v: unknown, pattern: RegExp, what: string): string {
    if (typeof v !== "string" || v.length > 500 || !pattern.test(v) || v.split("/").includes(".."))
        refuse(`${what} must be a path in your own dist/ folder (${pattern === FONT_PATH ? ".woff2" : ".png or .webp"})`);
    return v;
}

/** The skin's name, and its values with the right shapes; files and contrast are checked by `resolveSkin`. */
export function checkSkinRequest(v: unknown): { name: string; skin: TooltipSkin } {
    const o = record(v, ["name", "skin"], "the request");
    if (typeof o.name !== "string" || !SKIN_NAME.test(o.name))
        refuse("the name must be 1 to 32 of a-z, 0-9 and -");
    const s = record(o.skin, ["frame", "colors", "font", "pixelArt", "titleCaps"], "the skin");
    const skin: TooltipSkin = {};
    if (s.frame !== undefined) {
        const f = record(s.frame, ["image", "slice"], "frame");
        const slice = f.slice;
        if (!Array.isArray(slice) || slice.length !== 4 || !slice.every(n => Number.isInteger(n) && n >= 0 && n <= MAX_SLICE))
            refuse(`frame.slice must be four whole numbers from 0 to ${MAX_SLICE} (top, right, bottom, left)`);
        skin.frame = { image: bundlePath(f.image, FRAME_PATH, "frame.image"), slice: [...slice] as [number, number, number, number] };
    }
    if (s.colors !== undefined) {
        const c = record(s.colors, COLOR_KEYS, "colors");
        const colors: NonNullable<TooltipSkin["colors"]> = {};
        for (const key of COLOR_KEYS) {
            const value = c[key];
            if (value === undefined)
                continue;
            if (typeof value !== "string" || !HEX.test(value))
                refuse(`colors.${key} must be a colour like #1a2b3c`);
            colors[key] = value.toLowerCase();
        }
        skin.colors = colors;
    }
    if (s.font !== undefined)
        skin.font = bundlePath(s.font, FONT_PATH, "font");
    for (const key of ["pixelArt", "titleCaps"] as const) {
        if (s[key] === undefined)
            continue;
        if (typeof s[key] !== "boolean")
            refuse(`${key} must be true or false`);
        skin[key] = s[key] as boolean;
    }
    return { name: o.name, skin };
}

function luminance(hex: string): number {
    const channel = (i: number) => {
        const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

/**
 * A skin's colours with the ones left out filled in, refused when a pair is hard to read: text, muted text and the
 * effect box's text need 4.5:1 with what they sit on, the accent 3:1 with the surface and the box.
 */
export function skinColors(colors: NonNullable<TooltipSkin["colors"]>): SkinColors {
    if (!colors.surface || !colors.text)
        refuse("colors needs at least surface and text");
    const full: SkinColors = {
        surface: colors.surface,
        text: colors.text,
        muted: colors.muted ?? colors.text,
        accent: colors.accent ?? colors.text,
        box: colors.box ?? colors.surface,
        boxText: colors.boxText ?? colors.text,
    };
    const pairs: [keyof SkinColors, keyof SkinColors, number][] = [
        ["text", "surface", 4.5],
        ["muted", "surface", 4.5],
        ["boxText", "box", 4.5],
        ["accent", "surface", 3],
        ["accent", "box", 3],
    ];
    for (const [fore, back, least] of pairs) {
        const ratio = contrast(full[fore], full[back]);
        if (ratio < least)
            refuse(`colors.${fore} on colors.${back} is too hard to read (contrast ${ratio.toFixed(2)}:1, needs ${least}:1)`);
    }
    return full;
}

const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isWebp = (b: Buffer) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
const isWoff2 = (b: Buffer) => b.length >= 4 && b.toString("latin1", 0, 4) === "wOF2";

/** Reads one of the skin's files from the module's bundle and returns it as a data: URL, or refuses it. */
async function readSkinFile(root: string, file: string, kind: "frame" | "font"): Promise<string> {
    const what = kind === "frame" ? "frame.image" : "font";
    const real = await resolveAsset(root, "/" + file);
    if (!real)
        refuse(`${what} "${file}" isn't a file in your module`);
    let bytes: Buffer;
    try {
        if ((await stat(real)).size > MAX_SKIN_FILE)
            refuse(`${what} "${file}" is larger than 512 KB`);
        bytes = await readFile(real);
    }
    catch (error) {
        if (error instanceof HostError)
            throw error;
        refuse(`${what} "${file}" can't be read`);
    }
    if (bytes.length > MAX_SKIN_FILE)
        refuse(`${what} "${file}" is larger than 512 KB`);
    if (kind === "font") {
        if (!isWoff2(bytes))
            refuse(`font "${file}" isn't a WOFF2 font`);
        return `data:font/woff2;base64,${bytes.toString("base64")}`;
    }
    const type = isPng(bytes) ? "image/png" : isWebp(bytes) ? "image/webp" : undefined;
    if (!type)
        refuse(`frame.image "${file}" isn't a PNG or WebP picture`);
    return `data:${type};base64,${bytes.toString("base64")}`;
}

/** Checks a skin's colours and reads its files from the module's bundle (`root`, a real path). */
export async function resolveSkin(root: string, skin: TooltipSkin): Promise<ResolvedSkin> {
    const colors = skin.colors ? skinColors(skin.colors) : undefined;
    const resolved: ResolvedSkin = { pixelArt: skin.pixelArt === true, titleCaps: skin.titleCaps === true };
    if (colors)
        resolved.colors = colors;
    if (skin.frame)
        resolved.frame = { image: await readSkinFile(root, skin.frame.image, "frame"), slice: skin.frame.slice };
    if (skin.font)
        resolved.font = await readSkinFile(root, skin.font, "font");
    return resolved;
}

/** Each module's skins by name, for every panel of the module, until Tavora restarts. */
export class SkinStore {
    private readonly byModule = new Map<string, Map<string, ResolvedSkin>>();

    /** Refuses a new name when the module has `MAX_SKINS` already; an existing name is replaced. */
    checkRoom(module: string, name: string): void {
        const skins = this.byModule.get(module);
        if (skins && !skins.has(name) && skins.size >= MAX_SKINS)
            refuse(`a module can define at most ${MAX_SKINS} skins`);
    }

    async define(module: string, root: string, name: string, skin: TooltipSkin): Promise<void> {
        this.checkRoom(module, name);
        const resolved = await resolveSkin(root, skin);
        // Checked again: another define of this module may have finished while the files were read.
        this.checkRoom(module, name);
        const skins = this.byModule.get(module) ?? new Map<string, ResolvedSkin>();
        skins.set(name, resolved);
        this.byModule.set(module, skins);
    }

    get(module: string, name: string): ResolvedSkin | undefined {
        return this.byModule.get(module)?.get(name);
    }
}
