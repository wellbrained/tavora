// Shared by the official modules (Notes, To-Dos, UI Playground). Everything here uses only
// the public @tavora/sdk, like any community module could. The app imports only the
// components (components/ui/…), never this entry, so the SDK stays out of the host UI.

export { cn } from "./lib/utils";
export { createTranslator, type Params, type Translator } from "./i18n";
export { connectModule, type ConnectModuleOptions, type ModuleHandle } from "./connect-module";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { default as NameDialog } from "./components/NameDialog.vue";
export { checkName, type NameProblem } from "./components/name-check";
export { SegmentedControl, type SegmentedOption } from "./components/ui/segmented-control";
export { useDocument, type UseDocument } from "./use-document";
export { useItemSession, type UseItemSession } from "./use-item-session";
export { errorMessage } from "./documents";
export { createOptimistic, useOptimistic, useOptimisticKeyed, type Optimistic, type OptimisticOptions, type UseOptimistic, type UseOptimisticKeyed } from "./optimistic";

export{Tooltip,TooltipRows,type TooltipRow}from"./components/tooltip";
export{installTitleTooltips}from"./title-tooltips";
/** Writes the views zoomable panes are waiting to save; call it from `onSuspend` and `onDispose`. */
export { flushViewMemory } from "./components/ui/zoom-pane/view-memory";
