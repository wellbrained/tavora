// Shared by the official modules (Notes, To-Dos, UI Playground). Everything here uses only
// the public @tavora/sdk, like any community module could. The app imports only the
// components (components/ui/…), never this entry, so the SDK stays out of the host UI.

export { cn } from "./lib/utils";
export { bindDrag, type BindDragOptions, type DragBinding, type DragDelta, type DragHandlers, type DragPhase, type StartOptions } from "./lib/bind-drag";
export { createTranslator, type Params, type Translator } from "./i18n";
export { connectModule, type ConnectModuleOptions, type ModuleHandle } from "./connect-module";
export { applyKitTheme, onFontChange } from "./theme";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { default as NameDialog } from "./components/NameDialog.vue";
export { checkName, type NameProblem } from "./components/name-check";
export { SegmentedControl, type SegmentedOption } from "./components/ui/segmented-control";
export { useDocument, type UseDocument } from "./use-document";
export { patchStored } from "./patch-stored";
export { useItemSession, type UseItemSession } from "./use-item-session";
export { errorMessage } from "./documents";
export { createOptimistic, useOptimistic, useOptimisticKeyed, type Optimistic, type OptimisticOptions, type UseOptimistic, type UseOptimisticKeyed } from "./optimistic";
export { useTask, type Task, type TaskOptions, type TaskState, type TaskStatus } from "./use-task";
export { useFocusRecovery, type FocusRecovery } from "./focus-recovery";
export { usePaneKeys, isTypingTarget, type PaneKeyHandler, type PaneKeysOptions } from "./pane-keys";
export { useSlotGrid, type SlotGrid, type SlotGridOptions, type SlotKey } from "./components/ui/slot-grid";
export { copyImage, copyText } from "./clipboard";
export { renderToImage, type RenderToImageOptions } from "./render-to-image";

export{Tooltip,TooltipRows,useTooltip,isTruncated,type TooltipRow,type TooltipTrend,type TooltipWidth,type UseTooltip,type UseTooltipOptions,type UseSharedTooltipOptions,type TooltipTargetOptions,type TooltipCard}from"./components/tooltip";
export{ItemCard,type ItemCardSkin}from"./components/ui/item-card";
export{installTitleTooltips}from"./title-tooltips";
/** Writes the views zoomable panes are waiting to save; call it from `onSuspend` and `onDispose`. */
export { flushViewMemory } from "./components/ui/zoom-pane/view-memory";
