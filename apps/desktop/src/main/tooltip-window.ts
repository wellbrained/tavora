import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { TooltipRequest, TooltipSkin, TavoraTheme } from "@tavora/sdk/protocol";
import { withBundleImages } from "./tooltip-images";
import { TooltipState, tooltipBounds, type OpenTooltip } from "./tooltip-state";
import { TOOLTIP_DOCUMENT } from "../shared/tooltip-document";
import { SkinStore } from "./tooltip-skin";
import { InsertedCss } from "./inserted-css";
import { fontStylesheet } from "./module-fonts";
/** How long a card waits for its page to say it drew at its final size before it comes into sight anyway. */
const REVEAL_WAIT_MS = 120;
interface Source {
    root: string;
    /** The module's id: its skins are kept by it. */
    module: string;
    name: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
interface Options {
    parent: BrowserWindow;
    preload: string;
    hidden: boolean;
    theme(): TavoraTheme;
    language(): string;
    source(owner: string): Source | undefined;
    closed(owner: string, id: string): void;
}
/** A small, host-owned surface; never the module's renderer or the host's administrative preload. */
export class TooltipWindow {
    readonly state = new TooltipState();
    /** Each module's item-card skins (ui.tooltip.defineSkin), checked and with their files read in. */
    readonly skins = new SkinStore();
    /** The skins this tooltip window's page has been sent (by id); each goes over once, a card then names its id. */
    private sentSkins = new Set<number>();
    /** The interface font in the page, swapped when the user picks another (module-fonts.ts). */
    private readonly fontCss = new InsertedCss(() => this.window!.webContents);
    private window: BrowserWindow | undefined;
    private ready = false;
    private size = { width: 520, height: 2000 };
    /**
     * `hidden` (no card), `unseen` (shown see-through while the card is laid out, placed and drawn at its final size) or
     * `seen`. The next card takes the place of one in sight without the window being hidden in between.
     */
    private sight: "hidden" | "unseen" | "seen" = "hidden";
    /** Shows the card anyway if its page never says it drew. */
    private revealTimer: ReturnType<typeof setTimeout> | undefined;
    // A pinned tooltip stays when Tavora loses focus, so a screen capture (Win+Shift+S) can still take it. It belongs to the
    // Tavora window, so it never floats above other apps; a hover tooltip still closes.
    private onParentBlur = () => { setImmediate(() => { if (!this.state.current?.request.pinned && !this.options.parent.isDestroyed() && !this.options.parent.isFocused() && !this.window?.isFocused())
        this.close(); }); };
    constructor(private options: Options) {
        const p = options.parent;
        p.on("blur", this.onParentBlur);
        p.on("move", () => this.close());
        p.on("resize", () => this.close());
        p.on("hide", () => this.close());
        p.on("minimize", () => this.close());
        p.once("closed", () => this.dispose());
    }
    async show(owner: string, request: TooltipRequest): Promise<boolean> {
        const source = this.options.source(owner);
        if (!source)
            return false;
        const previous = this.state.current, open = this.state.show(owner, request);
        if (!open)
            return false;
        if (previous && (previous.owner !== owner || previous.request.id !== request.id))
            this.options.closed(previous.owner, previous.request.id);
        const w = this.ensureWindow();
        w.setIgnoreMouseEvents(!request.pinned || this.options.hidden, { forward: true });
        w.setFocusable(!!request.pinned && !this.options.hidden);
        const content = await withBundleImages(source.root, request.content);
        if (this.state.current !== open)
            return false;
        open.request = { ...open.request, content };
        if (this.sight !== "seen") {
            // Beside the new anchor and see-through before it is shown: the page may still hold the last card's frame.
            this.place();
            w.setOpacity(0);
            if (!w.isVisible())
                w.showInactive();
            this.sight = "unseen";
        }
        if (this.ready)
            this.render(open);
        return true;
    }
    /** ui.tooltip.defineSkin: checks the skin and reads its files from the module's bundle (`root`), or refuses it. */
    async defineSkin(module: string, root: string, name: string, skin: TooltipSkin): Promise<void> {
        const done = await this.skins.define(module, root, name, skin);
        if (!done)
            return;
        if (done.replaced !== undefined)
            this.dropSkins([done.replaced]);
        // A card of this skin already shown (plain, or in the skin's older form) is drawn again in it.
        const open = this.state.current, c = open?.request.content;
        if (open && this.ready && c?.layout === "card" && c.skin === name && this.options.source(open.owner)?.module === module)
            this.render(open);
    }
    /** A module reloads, updates, is turned off or removed: its skins go, here and in the tooltip window's page. */
    forgetModule(module: string) { this.dropSkins(this.skins.forgetModule(module)); }
    private dropSkins(ids: number[]) {
        const sent = ids.filter(id => this.sentSkins.delete(id));
        if (sent.length && this.window && !this.window.isDestroyed())
            this.window.webContents.send("tooltip:skin-drop", sent);
    }
    move(owner: string, id: string, at: TooltipRequest["at"], box?: TooltipRequest["box"]) { if (this.state.move(owner, id, at, box))
        this.place(); }
    close(owner?: string, id?: string, hoverOnly = false) {
        const closed = this.state.close(owner, id, hoverOnly);
        if (!closed)
            return;
        this.sight = "hidden";
        clearTimeout(this.revealTimer);
        this.window?.hide();
        this.options.closed(closed.owner, closed.request.id);
    }
    ensureVisible() { const c = this.state.current; if (c && !this.options.source(c.owner))
        this.close(); }
    private ensureWindow(): BrowserWindow {
        if (this.window && !this.window.isDestroyed())
            return this.window;
        this.sentSkins = new Set();
        this.fontCss.forget();
        const w = this.window = new BrowserWindow({ parent: this.options.parent, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: true,
            webPreferences: { partition: "tooltip-" + randomUUID(), preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false } });
        if (this.options.hidden)
            w.setOpacity(0);
        w.removeMenu();
        w.setIgnoreMouseEvents(true, { forward: true });
        w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        w.webContents.on("will-navigate", event => event.preventDefault());
        w.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        w.webContents.on("before-input-event", (event, input) => { if (input.key === "Escape") {
            event.preventDefault();
            this.close();
            if (!this.options.hidden)
                this.options.parent.focus();
        } });
        w.on("blur", this.onParentBlur);
        w.webContents.on("ipc-message", (_event, channel, ...args) => {
            const c = this.state.current;
            if (channel === "tooltip:ready") {
                this.ready = true;
                if (c)
                    this.render(c);
                return;
            }
            if (!c || args[0] !== c.serial)
                return;
            if (channel === "tooltip:close") {
                this.close();
                return;
            }
            if (channel === "tooltip:size" && typeof args[1] === "number" && Number.isFinite(args[1])) {
                this.size.height = Math.max(60, Math.min(2000, Math.ceil(args[1])));
                if (typeof args[2] === "number" && Number.isFinite(args[2]))
                    this.size.width = Math.max(120, Math.min(520, Math.ceil(args[2])));
                this.place();
                // Its final size (its pictures and letters are in): once the page has drawn it there, it comes into sight.
                if (this.state.current === c && this.sight === "unseen" && args[3] === true) {
                    w.webContents.send("tooltip:placed", c.serial);
                    clearTimeout(this.revealTimer);
                    this.revealTimer = setTimeout(() => this.reveal(c), REVEAL_WAIT_MS);
                }
                return;
            }
            if (channel === "tooltip:drawn")
                this.reveal(c);
        });
        w.webContents.once("render-process-gone", () => { this.close(); this.sight = "hidden"; this.ready = false; w.destroy(); this.window = undefined; });
        void w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(TOOLTIP_DOCUMENT)).catch(() => this.close());
        return w;
    }
    private reveal(open: OpenTooltip) {
        clearTimeout(this.revealTimer);
        const w = this.window;
        if (this.sight !== "unseen" || this.state.current !== open || !w || w.isDestroyed())
            return;
        this.sight = "seen";
        w.setOpacity(this.options.hidden ? 0 : 1);
    }
    /** Sends the page the card to lay out; the window goes to it once the page has measured it (tooltip:size). */
    private render(open: OpenTooltip) {
        const source = this.options.source(open.owner);
        if (!source) {
            this.close();
            return;
        }
        // A skin only dresses the card layout; a name the module hasn't defined (yet) shows the plain card. Its data goes
        // over once per page, then the card names it by id.
        const c = open.request.content, skin = c.layout === "card" && c.skin ? this.skins.get(source.module, c.skin) : undefined;
        if (skin && !this.sentSkins.has(skin.id)) {
            this.window!.webContents.send("tooltip:skin", skin.id, skin.skin);
            this.sentSkins.add(skin.id);
        }
        const theme = this.options.theme();
        void this.fontCss.replace(fontStylesheet(theme.font));
        this.window!.webContents.send("tooltip:render", { serial: open.serial, content: c, pinned: !!open.request.pinned, pinnable: open.request.pinnable !== false, source: source.name, theme, language: this.options.language(), room: this.room(), ...(skin ? { skin: skin.id } : {}) });
    }
    private place() {
        const c = this.state.current, w = this.window;
        if (!c || !w || w.isDestroyed())
            return;
        const source = this.options.source(c.owner);
        if (!source) {
            this.close();
            return;
        }
        const area = this.options.parent.getContentBounds(), dx = area.x + source.bounds.x, dy = area.y + source.bounds.y, box = c.request.box;
        w.setBounds(tooltipBounds({ x: dx + c.request.at.x, y: dy + c.request.at.y }, this.size, area, box && { ...box, x: dx + box.x, y: dy + box.y }));
    }
    /** The tallest the card can be in the window (tooltipBounds), so the page can tell when to make it compact. */
    private room() { return Math.max(1, this.options.parent.getContentBounds().height - 16); }
    dispose() { clearTimeout(this.revealTimer); this.sight = "hidden"; this.state.close(); if (this.window && !this.window.isDestroyed())
        this.window.destroy(); this.window = undefined; }
}
