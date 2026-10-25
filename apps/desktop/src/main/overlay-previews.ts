// The preview windows that are open (overlay-preview-window.ts), one per overlay: opened from a module's
// overlay.preview, or from Settings > Overlays and Settings > Streaming. Works whether or not Game overlays or
// Stream overlays are on.
import type { JsonValue } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import type { GameOverlaySource } from "./game-overlay-page";
import { overlayId } from "./game-overlays";
import type { OverlayPage, OverlayStore, OverlaySubject } from "./overlays";
import type { StreamingModule } from "./streaming";

/** What the manager needs of a preview window (a test stands in for Electron). */
export interface PreviewWindow {
  /** Brings it forward, also from the taskbar. */
  focus(): void;
  destroy(): void;
}

export interface PreviewRequest {
  id: string;
  /** The window's title: the module's name. */
  title: string;
  source: GameOverlaySource;
  /** The window closed (the player closed it). */
  closed(): void;
}

export interface OverlayPreviewsOptions {
  overlays: OverlayStore;
  /** The module as installed now (with its manifest in the player's language). */
  module(moduleId: string): StreamingModule | undefined;
  openWindow(request: PreviewRequest): PreviewWindow;
}

/** The preview windows that are open, one per overlay. */
export class OverlayPreviews {
  private readonly windows = new Map<string, PreviewWindow>();

  constructor(private readonly options: OverlayPreviewsOptions) {}

  /**
   * Opens the preview of the overlay `subject` of `module`, or brings its window forward. The module needs an
   * `overlay` in its manifest; the caller checked the key and, for a module, the click.
   */
  show(subject: OverlaySubject): void {
    const module = this.options.module(subject.moduleId);
    if (!module || module.owner !== subject.owner) throw new HostError("INVALID_PARAMS", "this module is not installed");
    if (!module.manifest.overlay) throw new HostError("INVALID_PARAMS", "this module has no overlay page in its manifest");
    const id = overlayId(subject);
    const existing = this.windows.get(id);
    if (existing) return existing.focus();
    // The page hears what the module publishes from the link; making it now means it is kept from here on.
    this.options.overlays.link(subject);
    const store = this.options.overlays;
    const window = this.options.openWindow({
      id,
      title: module.manifest.name,
      source: {
        page: (): OverlayPage | null => {
          const now = this.options.module(subject.moduleId);
          return now && now.owner === subject.owner && now.manifest.overlay ? { root: now.root, entry: now.manifest.overlay } : null;
        },
        state: (): JsonValue | null => store.peek(subject)?.state ?? null,
        watch: (fn) => {
          const link = store.peek(subject)?.link;
          return link ? store.watch(link.token, fn) : null;
        },
      },
      closed: () => void this.windows.delete(id),
    });
    this.windows.set(id, window);
  }

  /** Whether a preview of this overlay is open. */
  isOpen(subject: OverlaySubject): boolean {
    return this.windows.has(overlayId(subject));
  }

  /** Closes every preview (quitting, or the module went away). */
  closeAll(): void {
    for (const window of [...this.windows.values()]) {
      try {
        window.destroy();
      } catch {
        // The window is gone already.
      }
    }
    this.windows.clear();
  }

  /** Closes the previews of a module that was removed. */
  closeModule(moduleId: string, owner?: string): void {
    for (const [id, window] of [...this.windows]) {
      const [idOwner, idModule] = id.split("\n");
      if (idModule !== moduleId || (owner !== undefined && idOwner !== owner)) continue;
      window.destroy();
      this.windows.delete(id);
    }
  }
}
