// What can be done to the selected frames, once, for both the right-click menu (FrameMenu.vue) and the toolbar
// (FrameToolbar.vue): the label, the icon, what it sends and whether it is switched off. Which of them the toolbar shows is the
// user's pins (shared/layout-toolbar.ts).
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Lock,
  LockOpen,
  LocateFixed,
  Scaling,
  SendToBack,
  Settings,
  Trash2,
} from "@lucide/vue";
import type { Component } from "vue";
import type { LayoutItemView } from "../../../shared/layout-view";
import { ALIGN_ACTIONS, ARRANGE_ACTIONS, disabled, offered, selectionOf, type FrameActionId } from "../../../shared/layout-toolbar";
import { t } from "../../i18n";
import { send, view } from "./layout-state";

export interface FrameAction {
  id: FrameActionId;
  icon: Component;
  label: string;
  /** The rows of the submenu a group (Arrange, Align on screen) opens; they have no action of their own. */
  children?: FrameActionId[];
  run: () => void;
  disabled: boolean;
}

/** The rows of the Arrange and Align on screen submenus, in order. */
export const ARRANGE_CHILDREN: FrameActionId[] = ["front", "forward", "backward", "back"];
export const ALIGN_CHILDREN: FrameActionId[] = ["align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom"];

const none = () => {};

/** Every action for these frames (one or more); `offered` tells which of them make sense for the selection. */
export function frameActions(items: readonly LayoutItemView[]): Record<FrameActionId, FrameAction> {
  const ids = items.map((item) => item.id);
  const selection = selectionOf(items);
  // Shown again only when every one is hidden; else the ones still shown are hidden too.
  const hidden = selection.allHidden;
  const arrange = (to: keyof typeof ARRANGE_ACTIONS) => () => send({ type: "arrange", ids, to });
  const align = (edge: (typeof ALIGN_ACTIONS)[keyof typeof ALIGN_ACTIONS]) => () => send({ type: "align", ids, edge });
  const make = (id: FrameActionId, icon: Component, label: string, run: () => void, children?: FrameActionId[]): FrameAction => ({
    id,
    icon,
    label,
    run,
    disabled: !offered(id, selection) || disabled(id, selection),
    ...(children ? { children } : {}),
  });
  return {
    settings: make("settings", Settings, t("overlays.layout.settings"), () => send({ type: "settings", id: ids[0]! })),
    // Opens the list of games (the menu's submenu, or the toolbar's); nothing to copy to when there is no other game.
    copy: { ...make("copy", Copy, t("overlays.copy.button"), none), disabled: (view.value?.copyTargets.length ?? 0) === 0 },
    arrange: make("arrange", Layers, t("overlays.layout.arrange"), none, ARRANGE_CHILDREN),
    front: make("front", BringToFront, t("overlays.layout.front"), arrange("front")),
    forward: make("forward", ArrowUp, t("overlays.layout.forward"), arrange("forward")),
    backward: make("backward", ArrowDown, t("overlays.layout.backward"), arrange("backward")),
    back: make("back", SendToBack, t("overlays.layout.back"), arrange("back")),
    align: make("align", AlignHorizontalSpaceAround, t("overlays.layout.align"), none, ALIGN_CHILDREN),
    "align-left": make("align-left", AlignStartVertical, t("overlays.layout.alignLeft"), align("left")),
    "align-center": make("align-center", AlignCenterVertical, t("overlays.layout.alignCenter"), align("center")),
    "align-right": make("align-right", AlignEndVertical, t("overlays.layout.alignRight"), align("right")),
    "align-top": make("align-top", AlignStartHorizontal, t("overlays.layout.alignTop"), align("top")),
    "align-middle": make("align-middle", AlignCenterHorizontal, t("overlays.layout.alignMiddle"), align("middle")),
    "align-bottom": make("align-bottom", AlignEndHorizontal, t("overlays.layout.alignBottom"), align("bottom")),
    // All locked: unlock them. Otherwise lock every one that isn't.
    lock: make("lock", selection.allLocked ? LockOpen : Lock, t(selection.allLocked ? "overlays.layout.unlock" : "overlays.layout.lock"), () => send({ type: "lock", ids, locked: !selection.allLocked })),
    hide: make("hide", hidden ? EyeOff : Eye, t(hidden ? "overlays.layout.showOnCanvas" : "overlays.layout.hideOnCanvas"), () => send({ type: "canvas-hidden", ids, hidden: !hidden })),
    reset: make("reset", LocateFixed, t("overlays.layout.reset"), () => send({ type: "reset", ids })),
    "reset-size": make("reset-size", Scaling, t("overlays.layout.resetSize"), () => send({ type: "reset-size", ids })),
    remove: make("remove", Trash2, t("overlays.remove"), () => send({ type: "remove", ids })),
  };
}
