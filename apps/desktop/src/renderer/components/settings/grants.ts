// Taking back what a module was granted, after asking: everything it was granted goes, as in the consent dialog, and
// its data stays (decision log, module grants row of 2026-10-16). `unused` is what the question says for a module no
// workspace uses, with `{name}`.
import type { MessageKey } from "../../../shared/i18n";
import { confirmAction, listOf, state, submitAction, workspacesUsing } from "../../host";
import { t } from "../../i18n";

export type ModuleView = NonNullable<typeof state.value>["modules"][number];

export function revokeModule(module: ModuleView, unused: MessageKey): void {
  const workspaces = workspacesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: workspaces.length ? t("integrations.grants.revokeUsed", { name: module.name, workspaces: listOf(workspaces) }) : t(unused, { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}
