// Shared between the workspace and the components the docking library
// renders inside it (panel content, tabs and group actions).
import { ArrowLeftToLine, ArrowRightToLine, Columns2, Layers, Maximize2, Minimize2, Rows2, Trash2, X } from "@lucide/vue";
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-vue";
import type { InjectionKey } from "vue";
import { act, confirmAction, showOrAddPanel, state, submitAction, type MenuItem } from "../../host";
import { t } from "../../i18n";
import { leastAlong, type PanelInfo } from "../../dock";
import type { ColumnSide } from "../../dock-columns";

export interface DockContext {
  info(instanceId: string): PanelInfo | undefined;
  collapseSide(groupId: string): ColumnSide | undefined;
  collapseColumn(side: ColumnSide): void;
  /** Panel content elements report themselves, so the host can place module views over them. */
  register(instanceId: string, element: HTMLElement): void;
  unregister(instanceId: string, element: HTMLElement): void;
}

export const DOCK: InjectionKey<DockContext> = Symbol("dock");

function canSplit(group: DockviewGroupPanel, side: "right" | "below", info: DockContext["info"]): boolean {
  if (group.panels.length < 2) return false;
  const ids = group.panels.map((panel) => panel.id);
  return side === "right" ? group.width / 2 >= leastAlong(ids, true, group.height, info) : group.height / 2 >= leastAlong(ids, false, group.width, info);
}

/**
 * The modules in this workspace, A–Z, each with all its panel types (a module without types is one row). An open
 * type is checked and picking it brings that panel to the front; any other is added, placed from `from`, the
 * group whose menu was used (else the active one). New modules come from Add module.
 */
export function workspaceModulesMenu(from?: DockviewGroupPanel): MenuItem[] {
  const view = state.value;
  if (!view) return [];
  const inGame = new Set(view.panels.map((panel) => panel.moduleId));
  const modules = view.modules.filter((module) => inGame.has(module.id)).sort((a, b) => a.name.localeCompare(b.name));
  const items: MenuItem[] = [];
  let typed = false;
  for (const module of modules) {
    const row = (panelType: string | null, label: string): MenuItem => ({
      label,
      icon: { moduleId: module.id, panelType },
      checked: view.panels.some((panel) => panel.moduleId === module.id && panel.panelType === panelType),
      testid: `in-workspace-${module.id}${panelType ? `-${panelType}` : ""}`,
      run: () => {
        from?.api.setActive();
        showOrAddPanel(module.id, panelType);
      },
    });
    // A section per module with types; modules without types follow each other without one.
    const separator = items.length > 0 && (typed || module.panels.length > 0);
    typed = module.panels.length > 0;
    if (!typed) {
      items.push({ ...row(null, module.name), separator });
      continue;
    }
    items.push({ label: module.name, heading: true, icon: { moduleId: module.id }, separator, testid: `in-workspace-heading-${module.id}` });
    for (const type of module.panels) items.push(row(type.id, type.name));
  }
  return items;
}

/**
 * Keyboard and menu alternatives to dragging: everything a drag can do to a
 * panel is also here, on the ⋯ button and on right-click of its tab.
 */
export function panelMenu(panel: IDockviewPanel, api: DockviewApi, info: DockContext["info"]): MenuItem[] {
  const group = panel.group;
  const split = (direction: "right" | "below") => () => {
    const target = api.addGroup({ referenceGroup: group, direction });
    panel.api.moveTo({ group: target });
  };
  const move = (step: number) => () => {
    const groups = api.groups;
    const target = groups[(groups.indexOf(group) + step + groups.length) % groups.length]!;
    panel.api.moveTo({ group: target });
  };
  const maximized = group.api.isMaximized();
  const module = info(panel.id)?.module;
  // Items show only when they can be done: splitting takes a second tab in the group and room for both halves;
  // moving and maximizing take a second group.
  const several = api.groups.length > 1;
  const arrange: MenuItem[] = [];
  if (canSplit(group, "right", info)) arrange.push({ label: t("dock.splitRight"), testid: "panel-split-right", glyph: Columns2, run: split("right") });
  if (canSplit(group, "below", info)) arrange.push({ label: t("dock.splitDown"), testid: "panel-split-down", glyph: Rows2, run: split("below") });
  if (several) {
    arrange.push({ label: t("dock.moveNext"), testid: "panel-move-next", glyph: ArrowRightToLine, run: move(1) });
    arrange.push({ label: t("dock.movePrevious"), testid: "panel-move-previous", glyph: ArrowLeftToLine, run: move(-1) });
  }
  if (arrange[0]) arrange[0].separator = true;
  const size: MenuItem[] = maximized
    ? [{ label: t("dock.restore"), testid: "panel-restore", glyph: Minimize2, separator: true, run: () => group.api.exitMaximized() }]
    : several
      ? [{ label: t("dock.maximize"), testid: "panel-maximize", glyph: Maximize2, separator: true, run: () => group.api.maximize() }]
      : [];
  return [
    { label: t("workspace.inWorkspace"), testid: "panel-in-game", glyph: Layers, submenu: () => workspaceModulesMenu(group) },
    ...arrange,
    ...size,
    {
      label: t("dock.closePanel"),
      testid: "panel-close",
      glyph: X,
      separator: true,
      run: () => act({ type: "close-panel", instanceId: panel.id }),
    },
    // Removing takes the module's panels out of this workspace, not its data: the question says so.
    ...(module
      ? [
          {
            label: t("dock.removeModule", { name: module.name }),
            testid: "panel-remove-module",
            glyph: Trash2,
            danger: true,
            separator: true,
            run: () =>
              confirmAction({
                title: t("dock.removeModuleTitle", { name: module.name }),
                message: t("dock.removeModuleMessage", { name: module.name }),
                confirm: t("common.remove"),
                danger: true,
                run: () => submitAction({ type: "remove-module-from-workspace", moduleId: module.id }),
              }),
          },
        ]
      : []),
  ];
}
