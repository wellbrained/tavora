import { open } from "node:fs/promises";
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
/** The most inlined skin data (data: URL characters) Tavora keeps for all modules together; each file counts once. */
export const MAX_SKIN_DATA = 16 * 1024 * 1024;
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

/** The skin's name, and its values with the right shapes; files and contrast are checked by `SkinStore.define`. */
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
 * A skin's colours with the ones left out filled in, refused when a pair is hard to read: text, muted text, the effect
 * box's text and the accent in the box (its numbers are text too) need 4.5:1 with what they sit on; the accent on the
 * surface, where it is only a line, 3:1.
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
        ["accent", "box", 4.5],
        ["accent", "surface", 3],
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

/** A skin file as read: by its real path, so two skins that use one file share one copy. */
interface SkinFile {
    real: string;
    size: number;
    mtimeMs: number;
    type: "image/png" | "image/webp" | "font/woff2";
    url: string;
}

/** Reads at most `limit + 1` bytes from an open file: more than `limit` means it is too big, whatever its size said. */
async function readBounded(handle: Awaited<ReturnType<typeof open>>, limit: number): Promise<Buffer | undefined> {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0)
            break;
        length += bytesRead;
        if (length > limit)
            return undefined;
    }
    return buffer.subarray(0, length);
}

/**
 * Reads one of the skin's files from the module's bundle as a data: URL, or refuses it. The size is checked on the open
 * file and the read stops one byte past the limit. A file read before and unchanged (same size and time) is not read again.
 */
async function readSkinFile(root: string, file: string, kind: "frame" | "font", cache: Map<string, SkinFile>): Promise<SkinFile> {
    const what = kind === "frame" ? "frame.image" : "font";
    const real = await resolveAsset(root, "/" + file);
    if (!real)
        refuse(`${what} "${file}" isn't a file in your module`);
    const tooBig = () => refuse(`${what} "${file}" is larger than 512 KB`);
    let entry: SkinFile | undefined;
    let bytes: Buffer | undefined;
    try {
        const handle = await open(real, "r");
        try {
            const info = await handle.stat();
            if (!info.isFile())
                refuse(`${what} "${file}" isn't a file in your module`);
            if (info.size > MAX_SKIN_FILE)
                tooBig();
            const cached = cache.get(real);
            if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs)
                entry = cached;
            else {
                bytes = await readBounded(handle, MAX_SKIN_FILE);
                if (!bytes)
                    tooBig();
                entry = { real, size: info.size, mtimeMs: info.mtimeMs, type: "font/woff2", url: "" };
            }
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        if (error instanceof HostError)
            throw error;
        refuse(`${what} "${file}" can't be read`);
    }
    if (bytes) {
        const type = kind === "font" ? (isWoff2(bytes) ? "font/woff2" : undefined) : isPng(bytes) ? "image/png" : isWebp(bytes) ? "image/webp" : undefined;
        if (type)
            entry = { ...entry!, type, url: `data:${type};base64,${bytes.toString("base64")}` };
        else
            entry = undefined;
    }
    else if (entry && (kind === "font") !== (entry.type === "font/woff2"))
        entry = undefined;
    if (!entry)
        refuse(kind === "font" ? `font "${file}" isn't a WOFF2 font` : `frame.image "${file}" isn't a PNG or WebP picture`);
    cache.set(real, entry);
    return entry;
}

/** A skin as kept: its id (new for each define, so the tooltip window can be sent it once), the skin and its files. */
export interface StoredSkin {
    id: number;
    skin: ResolvedSkin;
    files: SkinFile[];
}

/**
 * Each module's skins by name, for every panel of the module, until Tavora restarts or the module is reloaded, updated,
 * turned off or removed (`forgetModule`). A file used by several skins is kept once, and all modules together keep at
 * most `MAX_SKIN_DATA` of inlined files. When the same name is defined twice at once, the later call wins.
 */
export class SkinStore {
    private readonly byModule = new Map<string, Map<string, StoredSkin>>();
    private readonly files = new Map<string, SkinFile>();
    /** The newest define of each module and name, and each module's forget count: an older or forgotten define is dropped. */
    private readonly calls = new Map<string, number>();
    private readonly generations = new Map<string, number>();
    private nextId = 1;

    /** `maxData`: the most inlined data kept for all modules together (smaller in tests). */
    constructor(private readonly maxData = MAX_SKIN_DATA) { }

    /** Refuses a new name when the module has `MAX_SKINS` already; an existing name is replaced. */
    checkRoom(module: string, name: string): void {
        const skins = this.byModule.get(module);
        if (skins && !skins.has(name) && skins.size >= MAX_SKINS)
            refuse(`a module can define at most ${MAX_SKINS} skins`);
    }

    /**
     * Checks the skin and reads its files. Answers what is now kept and the id of the skin it replaced, or nothing when a
     * later define of the same name (or a `forgetModule`) came first: then this one is dropped without an error.
     */
    async define(module: string, root: string, name: string, skin: TooltipSkin): Promise<{ stored: StoredSkin; replaced?: number } | undefined> {
        this.checkRoom(module, name);
        const key = module + "\n" + name, call = (this.calls.get(key) ?? 0) + 1, generation = this.generations.get(module) ?? 0;
        this.calls.set(key, call);
        const colors = skin.colors ? skinColors(skin.colors) : undefined;
        const resolved: ResolvedSkin = { pixelArt: skin.pixelArt === true, titleCaps: skin.titleCaps === true };
        const files: SkinFile[] = [];
        if (colors)
            resolved.colors = colors;
        try {
            if (skin.frame) {
                const frame = await readSkinFile(root, skin.frame.image, "frame", this.files);
                files.push(frame);
                resolved.frame = { image: frame.url, slice: skin.frame.slice };
            }
            if (skin.font) {
                const font = await readSkinFile(root, skin.font, "font", this.files);
                files.push(font);
                resolved.font = font.url;
            }
        }
        finally {
            this.prune();
        }
        if (this.calls.get(key) !== call || (this.generations.get(module) ?? 0) !== generation)
            return undefined;
        // Checked again: another define of this module may have finished while the files were read.
        this.checkRoom(module, name);
        const skins = this.byModule.get(module) ?? new Map<string, StoredSkin>();
        const previous = skins.get(name);
        const total = this.dataSize(files, previous);
        if (total > this.maxData)
            refuse(`Tavora keeps at most ${Math.round(this.maxData / 1024 / 1024)} MB of skin files for all modules, and this skin would go over it`);
        const stored: StoredSkin = { id: this.nextId++, skin: resolved, files };
        skins.set(name, stored);
        this.byModule.set(module, skins);
        for (const file of files)
            this.files.set(file.real, file);
        this.prune();
        return { stored, ...(previous ? { replaced: previous.id } : {}) };
    }

    get(module: string, name: string): StoredSkin | undefined {
        return this.byModule.get(module)?.get(name);
    }

    /** Drops all of a module's skins (it reloads, updates, is turned off or removed); answers their ids. */
    forgetModule(module: string): number[] {
        this.generations.set(module, (this.generations.get(module) ?? 0) + 1);
        const skins = this.byModule.get(module);
        this.byModule.delete(module);
        this.prune();
        return skins ? [...skins.values()].map(s => s.id) : [];
    }

    /** The inlined data kept with `files` added and `without` gone, each file once. */
    private dataSize(files: SkinFile[], without?: StoredSkin): number {
        const sizes = new Map<string, number>();
        for (const skins of this.byModule.values())
            for (const stored of skins.values())
                if (stored !== without)
                    for (const file of stored.files)
                        sizes.set(file.real, file.url.length);
        for (const file of files)
            sizes.set(file.real, file.url.length);
        let total = 0;
        for (const size of sizes.values())
            total += size;
        return total;
    }

    /** Lets go of files no kept skin uses. */
    private prune(): void {
        const used = new Set<string>();
        for (const skins of this.byModule.values())
            for (const stored of skins.values())
                for (const file of stored.files)
                    used.add(file.real);
        for (const real of this.files.keys())
            if (!used.has(real))
                this.files.delete(real);
    }
}
