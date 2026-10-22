// Shared by the official modules (Notes, To-Dos, UI Playground). Everything here uses only
// the public @tavora/sdk, like any community module could. The app imports only the
// components (components/ui/…), never this entry, so the SDK stays out of the host UI.

import { connect, type TavoraSDK } from "@tavora/sdk";
import { applyTheme } from "./theme";

export { cn } from "./lib/utils";
export { createTranslator, type Params, type Translator } from "./i18n";
export { applyTheme } from "./theme";
export { default as ConfirmDialog } from "./components/ConfirmDialog.vue";
export { default as SegmentedControl } from "./components/SegmentedControl.vue";
export { errorMessage, readDocument, serial, updateDocument, type UpdateOptions, type Versioned } from "./documents";

/**
 * Connects to Tavora and keeps the page's CSS tokens in step with the host theme.
 * `onLanguage` gets the language Tavora shows its texts in now and whenever the player changes it.
 */
export async function connectModule(onLanguage?: (language: string) => void): Promise<TavoraSDK> {
  const sdk = await connect();
  applyTheme(await sdk.ui.getTheme());
  sdk.ui.onThemeChange(applyTheme);
  if (onLanguage) {
    onLanguage(await sdk.ui.getLanguage());
    sdk.ui.onLanguageChange(onLanguage);
  }
  return sdk;
}

export{Tooltip}from"./components/tooltip";
export{installTitleTooltips}from"./title-tooltips";
