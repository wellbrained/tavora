// Shared by the official modules (Notes, To-Dos, UI Playground). Everything here uses only
// the public @tavora/sdk, like any community module could.

import { connect, type TavoraSDK } from "@tavora/sdk";
import { applyTheme } from "./theme";

export { cn } from "./lib/utils";
export { applyTheme } from "./theme";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { default as SegmentedControl } from "./components/SegmentedControl.vue";
export { errorMessage, readDocument, serial, updateDocument, type UpdateOptions, type Versioned } from "./documents";

/** Connects to Tavora and keeps the page's CSS tokens in step with the host theme. */
export async function connectModule(): Promise<TavoraSDK> {
  const sdk = await connect();
  applyTheme(await sdk.ui.getTheme());
  sdk.ui.onThemeChange(applyTheme);
  return sdk;
}
