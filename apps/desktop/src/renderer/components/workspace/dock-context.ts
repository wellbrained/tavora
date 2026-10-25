// Shared between the workspace and the components the docking library
// renders inside it (panel content, tabs and group actions).
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-vue";
import type { InjectionKey } from "vue";
import { act, showOrAddPanel, state, type MenuItem } from "../../host";
import { t } from "../../i18n";
import { TAB_HEIGHT, type PanelInfo } from "../../dock";
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
  let width = 0;
  let height = 0;
  for (const panel of group.panels) {
    width = Math.max(width, info(panel.id)?.minWidth ?? 0);
    height = Math.max(height, (info(panel.id)?.minHeight ?? 0) + TAB_HEIGHT);
  }
  return side === "right" ? group.width / 2 >= width : group.height / 2 >= height;
}

/**
 * The modules in this game, A–Z, each with all its panel types (a module without types is one row). An open
 * type is checked and picking it brings that panel to the front; any other is added, placed from `from`, the
 * group whose menu was used (else the active one). New modules come from Add module.
 */
export function gameModulesMenu(from?: DockviewGroupPanel): MenuItem[] {
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
      testid: `in-game-${module.id}${panelType ? `-${panelType}` : ""}`,
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
    items.push({ label: module.name, heading: true, icon: { moduleId: module.id }, separator, testid: `in-game-heading-${module.id}` });
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
  const entry = state.value?.panels.find((item) => item.instanceId === panel.id);
  return [
    { label: t("workspace.inGame"), testid: "panel-in-game", submenu: () => gameModulesMenu(group) },
    {
      label: t("dock.splitRight"),
      testid: "panel-split-right",
      separator: true,
      disabled: !canSplit(group, "right", info),
      run: split("right"),
    },
    {
      label: t("dock.splitDown"),
      testid: "panel-split-down",
      disabled: !canSplit(group, "below", info),
      run: split("below"),
    },
    {
      label: t("dock.moveNext"),
      testid: "panel-move-next",
      disabled: api.groups.length < 2,
      run: move(1),
    },
    {
      label: t("dock.movePrevious"),
      testid: "panel-move-previous",
      disabled: api.groups.length < 2,
      run: move(-1),
    },
    maximized
      ? { label: t("dock.restore"), testid: "panel-restore", separator: true, run: () => group.api.exitMaximized() }
      : {
          label: t("dock.maximize"),
          testid: "panel-maximize",
          separator: true,
          disabled: api.groups.length < 2,
          run: () => group.api.maximize(),
        },
    // Only for panel types the module marked for the game, and where Tavora can draw over a game; with Game overlays off the item opens Settings > Overlays.
    ...(module && entry?.canInGame && state.value?.gameOverlays.supported
      ? [
          entry.inGame
            ? { label: t("dock.stopInGame"), testid: "panel-stop-in-game", separator: true, run: () => act({ type: "stop-panel-in-game", instanceId: panel.id }) }
            : { label: t("dock.showInGame"), testid: "panel-show-in-game", separator: true, run: () => act({ type: "show-panel-in-game", instanceId: panel.id }) },
        ]
      : []),
    {
      label: t("dock.closePanel"),
      testid: "panel-close",
      separator: true,
      run: () => act({ type: "close-panel", instanceId: panel.id }),
    },
    ...(module
      ? [
          {
            label: t("dock.removeModule", { name: module.name }),
            testid: "panel-remove-module",
            danger: true,
            run: () => act({ type: "remove-module-from-game", moduleId: module.id }),
          },
        ]
      : []),
  ];
}
