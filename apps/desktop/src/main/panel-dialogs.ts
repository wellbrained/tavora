import type { ModuleMenu, PanelDialog } from "../shared/host-api";
import type { PanelDialogSize } from "./bridge";
import type { CheckedMenu } from "./module-menu";
import type { PanelRect, PanelViews } from "./panel-views";
import type { PendingQuestions } from "./pending-questions";
import type { InstalledModule } from "./registry";

/** How long a dialog asked for from the in-game layer, or by a panel not in its slot yet, waits for the panel to be there. */
export const PENDING_DIALOG_MS = 5000;
/** How big the dialog is that Settings on an overlay's frame opens over the Overlay page (a module sets its own size when it opens its dialog itself). */
export const OVERLAY_SETTINGS_DIALOG = { width: 960, height: 680 } as const;

export interface PanelDialogsOptions {
  /** Every open question; a module's menu (`menu`) and a dialog waiting for its panel (`dialog`) are among them. */
  questions: PendingQuestions;
  /** The panels' views: their places, their dialog, a menu over it, and how they step aside for the host page's popups (panel-views.ts). */
  panels: Pick<PanelViews, "has" | "mayShowMenu" | "inDialog" | "openDialogMenu" | "closeDialogMenu" | "isLent" | "isPlaced" | "openDialog" | "closeDialog" | "dialog" | "freeze" | "prepareFreeze">;
  /** The host window's page, which draws the menus and the dialog frames. */
  page: {
    send(channel: "host:module-menu" | "host:panel-dialog" | "host:panel-dialog-title" | "host:panel-dialog-drawn", payload: unknown): void;
    /** The keyboard goes to the host page. */
    focus(): void;
    /** The window has the keyboard. */
    focused(): boolean;
    /** The window is gone (Tavora is closing). */
    gone(): boolean;
  };
  /** A dialog's frame: the module's name in Tavora's language and its icon. */
  describe: (module: InstalledModule) => { title: string; icon: string | null };
  /** Closes a panel's tooltip, or every tooltip. */
  closeTooltips: (instanceId?: string) => void;
  /** The keyboard goes back to a panel's page, when it is still there. */
  focusPanel: (instanceId: string) => void;
  /** The panel is one of the workspace shown now. */
  inShownWorkspace: (instanceId: string) => boolean;
  /** A panel over the game that opens its dialog. */
  fromGame: {
    /** The workspace of a panel in the in-game layer, when that workspace is still there; else null. */
    workspaceOf(instanceId: string): string | null;
    /** The layer closes and Tavora comes to the front on that workspace. */
    bringBack(workspaceId: string): void;
  };
}

/**
 * What the host page draws over the panels: a module's menus, a panel shown big in its dialog, and the host's own menus,
 * hints, dialogs and drags (popups over panels). One menu at a time and one dialog at a time; a new one closes the last.
 * A dialog a panel asks for before it is in its slot (just added, or over the game) waits for it a moment. The panels'
 * own views step aside or move (panel-views.ts, by the one state in shared/popups-over-panels.ts); this decides when,
 * tells the host page what to draw, and where the keyboard goes.
 */
export class PanelDialogs {
  constructor(private readonly options: PanelDialogsOptions) {}

  /**
   * Draws a module's menu in the host page, over its panel and every other one; resolves with the chosen item's id, or
   * null. Nothing is shown for a panel that is hidden or under a host menu or dialog; a panel in its own dialog can show
   * one, once its view has stepped aside for it.
   */
  showMenu(instanceId: string, menu: CheckedMenu): Promise<string | null> {
    const { panels, questions, page } = this.options;
    if (!panels.has(instanceId) || !panels.mayShowMenu(instanceId) || page.gone()) return Promise.resolve(null);
    this.closeMenu();
    const { id: requestId, answer } = questions.ask("menu", { panel: instanceId }, { choices: menu.choices });
    const shown: ModuleMenu = { requestId, instanceId, ...menu.request };
    const draw = () => {
      if (questions.peek("menu")?.id !== requestId || page.gone()) return;
      // The menu is drawn by the host page, so the keyboard goes there while it is open.
      page.focus();
      page.send("host:module-menu", shown);
    };
    if (panels.inDialog(instanceId)) {
      this.options.closeTooltips(instanceId);
      void panels.openDialogMenu(instanceId).then(draw);
    } else draw();
    return answer;
  }

  /** The user chose an item or closed the menu. Only an item the module offered (and did not disable) counts. */
  answerMenu(raw: unknown): void {
    const { questions } = this.options;
    const answer = (typeof raw === "object" && raw !== null ? raw : {}) as { requestId?: unknown; id?: unknown };
    const open = questions.peek("menu");
    if (!open || answer.requestId !== open.id) return;
    questions.answer(open.id, typeof answer.id === "string" && open.payload.choices.has(answer.id) ? answer.id : null);
    this.options.panels.closeDialogMenu();
    // The keyboard goes back to the panel, so an action such as Rename can take it.
    if ("panel" in open.scope) this.options.focusPanel(open.scope.panel);
  }

  /** Closes the module menu shown now (only if it belongs to `instanceId`, when given), as if nothing was chosen. */
  closeMenu(instanceId?: string): void {
    const { questions, panels, page } = this.options;
    const ended = instanceId === undefined ? questions.cancelKind("menu") : questions.cancel({ panel: instanceId }, "menu");
    if (ended) panels.closeDialogMenu();
    if (ended && !page.gone()) page.send("host:module-menu", null);
  }

  /**
   * Shows a panel big in a dialog centred over the workspace: the host page draws the frame (the module's name and a
   * close button) over the dimmed app and says where the page goes; the panel's own view moves there, so it keeps
   * everything it had. Only a panel in sight in the workspace; a panel over the game comes back first. A dialog opened by
   * a click closes on a click beside it; one a panel just added opened on its own (a welcome) does not.
   */
  open(instanceId: string, module: InstalledModule, size: PanelDialogSize, byClick = true): void {
    const { panels, questions, page } = this.options;
    if (panels.isLent(instanceId)) return this.openFromGame(instanceId, module, size);
    if (page.gone()) return;
    // A panel just added can ask before the host page has given it its slot: it opens once it is there, if that is soon.
    if (!panels.isPlaced(instanceId) && this.options.inShownWorkspace(instanceId)) {
      void questions.ask("dialog", { panel: instanceId }, { module, size, until: Date.now() + PENDING_DIALOG_MS, byClick });
      return;
    }
    if (!panels.openDialog(instanceId, size)) return;
    this.shown(instanceId, module, size, byClick);
  }

  /**
   * The Overlay page's Settings button: the panel behind an item comes up in its dialog over the page, which stays where
   * it is, and hears which thing the user means (panel.onOpenSettings) once its page has connected, if that is soon. A
   * page without a handler shows the panel as it is. Closing the dialog leaves the user on the Overlay page.
   */
  openSettings(instanceId: string, module: InstalledModule, panel: { openSettings(key: string): boolean }, key: string | null): void {
    if (!this.options.panels.openDialog(instanceId, OVERLAY_SETTINGS_DIALOG, true)) return;
    this.shown(instanceId, module, OVERLAY_SETTINGS_DIALOG, true);
    if (key === null) return;
    const until = Date.now() + PENDING_DIALOG_MS;
    const send = (): void => {
      if (panel.openSettings(key) || Date.now() > until || this.options.panels.dialog?.instanceId !== instanceId) return;
      setTimeout(send, 100);
    };
    send();
  }

  /** panel.setDialogTitle: the frame of this panel's dialog shows `title` (null: the module's name); nothing while it has no dialog open. */
  setTitle(instanceId: string, title: string | null): void {
    if (this.options.page.gone() || this.options.panels.dialog?.instanceId !== instanceId) return;
    this.options.page.send("host:panel-dialog-title", { instanceId, title });
  }

  /** panel.closeDialog: puts the panel back, and drops a dialog it asked for that is still waiting for its slot. */
  close(instanceId: string): void {
    this.options.questions.cancel({ panel: instanceId }, "dialog");
    this.options.panels.closeDialog(instanceId);
  }

  /** Opens the dialog a panel asked for before it was in its slot, now that it may be; a panel that took too long misses it. */
  openPending(): void {
    const { questions, panels } = this.options;
    const pending = questions.peek("dialog");
    if (!pending || !("panel" in pending.scope)) return;
    const instanceId = pending.scope.panel;
    if (Date.now() > pending.payload.until) {
      questions.cancel(pending.id);
      return;
    }
    if (panels.isLent(instanceId) || !panels.isPlaced(instanceId)) return;
    questions.answer(pending.id, true);
    this.open(instanceId, pending.payload.module, pending.payload.size, pending.payload.byClick);
  }

  /**
   * The host page's popups over the panels: a menu, hint, dialog or drag opened (`open`), or the last one closed. `only`:
   * the panels a menu or hint lies over, added to those asked before; none: every panel. Each request `seq` is answered
   * once its panels are out of the way (host:overlay-ready).
   */
  popups(open: boolean, only: readonly string[] | undefined, seq: number): void {
    void this.options.panels.freeze(open, only, seq);
  }

  /** The user reaches for something that may open over the panels: their pictures are taken ahead, near `near` or everywhere. */
  preparePopups(near?: PanelRect): void {
    this.options.panels.prepareFreeze(near);
  }

  /** A panel's dialog closed (panel-views.ts): its tooltips and menu go with it, and the keyboard goes back to the host page. */
  closed(instanceId: string): void {
    // A tooltip or menu of the panel in its dialog was placed there; neither outlives it.
    this.options.closeTooltips();
    this.closeMenu(instanceId);
    const { page } = this.options;
    if (page.gone()) return;
    page.send("host:panel-dialog", null);
    // The dialog's page may have held the keys; they go back to the host page (which returns focus to where it was).
    if (page.focused()) page.focus();
  }

  /** The panel's page has drawn in its dialog: the host page can show the frame. */
  drawn(instanceId: string): void {
    if (!this.options.page.gone()) this.options.page.send("host:panel-dialog-drawn", instanceId);
  }

  /** The panel's view is in its dialog: a menu or tooltip shown now goes, and the host page draws the frame. */
  private shown(instanceId: string, module: InstalledModule, size: PanelDialogSize, closesOnClickBeside: boolean): void {
    this.closeMenu();
    this.options.closeTooltips(instanceId);
    const dialog: PanelDialog = { instanceId, ...this.options.describe(module), ...size, closesOnClickBeside };
    this.options.page.send("host:panel-dialog", dialog);
  }

  /**
   * A panel over the game opens its dialog: the layer closes, Tavora comes to the front on the panel's workspace, and the
   * dialog opens as soon as the panel is back in its slot, if that happens soon.
   */
  private openFromGame(instanceId: string, module: InstalledModule, size: PanelDialogSize): void {
    const workspaceId = this.options.fromGame.workspaceOf(instanceId);
    if (!workspaceId || this.options.page.gone()) return;
    void this.options.questions.ask("dialog", { panel: instanceId }, { module, size, until: Date.now() + PENDING_DIALOG_MS, byClick: true });
    this.options.fromGame.bringBack(workspaceId);
    this.openPending();
  }
}
