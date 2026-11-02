// Does a drop on the real dock, through dockview's own API, so the result is what dock-model.ts predicted.
import type { DockviewApi, DockviewGroupPanel, Position } from "dockview-vue";
import type { Dragged, DropTarget, Side } from "./dock-model";

/** Where dockview's `addGroup` puts a group for each side of the dock. */
const DIRECTION = { left: "left", right: "right", top: "above", bottom: "below" } as const;

/** Moves the dragged panel (or whole group) to the target; false when something it names is gone. */
export function applyDrop(api: DockviewApi, dragged: Dragged, target: DropTarget): boolean {
  const source = api.getGroup(dragged.groupId);
  if (!source) return false;
  let group: DockviewGroupPanel | undefined;
  let position: Position;
  let index: number | undefined;
  if (target.kind === "edge") {
    // moveTo has no target for the dock's outer edge: an empty group is added there, and the panel goes into it.
    group = api.addGroup({ direction: DIRECTION[target.side as Side] }) as DockviewGroupPanel;
    position = "center";
  } else {
    group = api.getGroup(target.group) as DockviewGroupPanel | undefined;
    position = target.kind === "tab" ? "center" : target.side;
    index = target.kind === "tab" ? target.index : undefined;
  }
  if (!group) return false;
  const to = { group, position, ...(index === undefined ? {} : { index }) };
  if (dragged.panelId) {
    const panel = api.getPanel(dragged.panelId);
    if (!panel) return false;
    panel.api.moveTo(to);
  } else {
    source.api.moveTo(to);
  }
  return true;
}
