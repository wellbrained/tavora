import { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { TooltipRequest, TavoraTheme } from "@tavora/sdk/protocol";
import { resolveAsset, contentTypeFor } from "./assets";
import { TooltipState, tooltipBounds, type OpenTooltip } from "./tooltip-state";
import { TOOLTIP_DOCUMENT } from "../shared/tooltip-document";
interface Source {
    root: string;
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
    private window: BrowserWindow | undefined;
    private ready = false;
    private size = { width: 520, height: 2000 };
    private onParentBlur = () => { setImmediate(() => { if (!this.options.parent.isDestroyed() && !this.options.parent.isFocused() && !this.window?.isFocused())
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
        w.hide();
        w.setIgnoreMouseEvents(!request.pinned || this.options.hidden, { forward: true });
        w.setFocusable(!!request.pinned && !this.options.hidden);
        this.size = { width: 520, height: 2000 };
        let image: string | undefined;
        if (request.content.image) {
            const file = await resolveAsset(source.root, "/" + request.content.image);
            try {
                if (file && (await stat(file)).size <= 512000) {
                    const bytes = await readFile(file);
                    if (bytes.length <= 512000)
                        image = `data:${contentTypeFor(file)};base64,${bytes.toString("base64")}`;
                }
            }
            catch { /* Missing artwork leaves the text intact. */ }
        }
        if (this.state.current !== open)
            return false;
        const { image: _bundleImage, ...content } = request.content;
        open.request = { ...open.request, content: { ...content, ...(image ? { image } : {}) } };
        if (this.ready)
            this.render(open);
        return true;
    }
    move(owner: string, id: string, at: TooltipRequest["at"]) { if (this.state.move(owner, id, at))
        this.place(); }
    close(owner?: string, id?: string, hoverOnly = false) {
        const closed = this.state.close(owner, id, hoverOnly);
        if (!closed)
            return;
        this.window?.hide();
        this.options.closed(closed.owner, closed.request.id);
    }
    ensureVisible() { const c = this.state.current; if (c && !this.options.source(c.owner))
        this.close(); }
    private ensureWindow(): BrowserWindow {
        if (this.window && !this.window.isDestroyed())
            return this.window;
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
                if (this.state.current === c)
                    w.showInactive();
            }
        });
        w.webContents.once("render-process-gone", () => { this.close(); this.ready = false; w.destroy(); this.window = undefined; });
        void w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(TOOLTIP_DOCUMENT)).catch(() => this.close());
        return w;
    }
    private render(open: OpenTooltip) {
        const source = this.options.source(open.owner);
        if (!source) {
            this.close();
            return;
        }
        this.place();
        this.window!.webContents.send("tooltip:render", { serial: open.serial, content: open.request.content, pinned: !!open.request.pinned, source: source.name, theme: this.options.theme(), language: this.options.language() });
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
        const area = this.options.parent.getContentBounds();
        w.setBounds(tooltipBounds({ x: area.x + source.bounds.x + c.request.at.x, y: area.y + source.bounds.y + c.request.at.y }, this.size, area));
    }
    dispose() { this.state.close(); if (this.window && !this.window.isDestroyed())
        this.window.destroy(); this.window = undefined; }
}
