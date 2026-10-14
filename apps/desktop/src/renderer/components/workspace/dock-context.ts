// Shared between the workspace and the components the docking library
// renders inside it (panel content, tabs and group actions).
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-vue";
import type { InjectionKey } from "vue";
import { act, type MenuItem } from "../../host";
import { TAB_HEIGHT, type PanelInfo } from "../../dock";

export interface DockContext {
  info(instanceId: string): PanelInfo | undefined;
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
  return [
    {
      label: "Split right",
      testid: "panel-split-right",
      disabled: !canSplit(group, "right", info),
      run: split("right"),
    },
    {
      label: "Split down",
      testid: "panel-split-down",
      disabled: !canSplit(group, "below", info),
      run: split("below"),
    },
    {
      label: "Move to next group",
      testid: "panel-move-next",
      disabled: api.groups.length < 2,
      run: move(1),
    },
    {
      label: "Move to previous group",
      testid: "panel-move-previous",
      disabled: api.groups.length < 2,
      run: move(-1),
    },
    maximized
      ? { label: "Restore", testid: "panel-restore", separator: true, run: () => group.api.exitMaximized() }
      : {
          label: "Maximize",
          testid: "panel-maximize",
          separator: true,
          disabled: api.groups.length < 2,
          run: () => group.api.maximize(),
        },
    {
      label: "Close panel",
      testid: "panel-close",
      separator: true,
      run: () => act({ type: "close-panel", instanceId: panel.id }),
    },
  ];
}
