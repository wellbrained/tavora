// Opens a Codex entry from the Planner: the Codex already showing it, the one used last, or a new one.

import { t } from "../../i18n";
import type { ModuleContext } from "../context";

/** `id` is a Codex content id: `item:<id>` or `recipe:<id>`. Call it from the click that asked for it. */
export function showInCodex(context: ModuleContext, id: string, title: string): void {
  void context.sdk.panels.open("codex", { content: { id, title } }).catch(() => context.notify(t("notice.openFailed")));
}
