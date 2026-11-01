// What a Clock & Counter panel shares with its cards: the store, the time now (ticking while a clock runs), which
// hotkeys are set, and the calls that need the click that asked for them.
import type { GameOverlayResult, MenuOptions } from "@tavora/sdk";
import type { InjectionKey, Ref } from "vue";
import type { Item, ItemKind } from "./items";
import type { ItemStore } from "./store";

/** The manifest's `actions`. */
export type ActionId = "start-pause" | "reset" | "lap" | "up" | "down";

/** What each kind can do on a key press. */
export const ACTIONS: Record<ItemKind, readonly ActionId[]> = {
  countdown: ["start-pause", "reset"],
  stopwatch: ["start-pause", "reset", "lap"],
  counter: ["up", "down", "reset"],
};

export interface PanelContext {
  store: ItemStore;
  now: Ref<number>;
  /** `action:target` for each hotkey set in this workspace. */
  hotkeys: Ref<ReadonlySet<string>>;
  /** Runs an action on an item, as a button or a hotkey does. */
  act(action: string, itemId: string): void;
  setHotkey(action: string, item: Item): Promise<void>;
  copyLink(item: Item): Promise<"copied" | "off" | "denied">;
  /** Keys of the overlays shown over the game now. */
  overGame: Ref<ReadonlySet<string>>;
  /** The key of the overlay an item's link and Over game switch belong to: its own, or its group's when shown as a whole. */
  keyOf(item: Item): string;
  showOverGame(item: Item): Promise<GameOverlayResult>;
  hideOverGame(key: string): Promise<void>;
  preview(item: Item): Promise<void>;
  resetLink(item: Item): Promise<void>;
  remove(item: Item): void;
  showMenu(request: MenuOptions): Promise<string | null>;
}

export const PANEL: InjectionKey<PanelContext> = Symbol("clock-counter-panel");

export const UNDO_MS = 6000;
