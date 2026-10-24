import { Orientation, type SerializedDockview } from "dockview-vue";

type GridNode = SerializedDockview["grid"]["root"];
export type ColumnSide = "left" | "right";

export interface DockColumn {
  side: ColumnSide;
  groups: string[];
  panels: string[];
  hidden: boolean;
  width: number;
  canCollapse: boolean;
}

function members(node: GridNode): { groups: string[]; panels: string[] } {
  if (node.type === "leaf") {
    const group = node.data as Exclude<GridNode["data"], GridNode[]>;
    return { groups: [group.id], panels: group.views };
  }
  const children = (node.data as GridNode[]).map(members);
  return { groups: children.flatMap((child) => child.groups), panels: children.flatMap((child) => child.panels) };
}

export function outerColumns(json: SerializedDockview): DockColumn[] {
  let root = json.grid.root;
  let orientation = json.grid.orientation;
  while (root.type === "branch" && (root.data as GridNode[]).length === 1) {
    root = (root.data as GridNode[])[0]!;
    orientation = orientation === Orientation.HORIZONTAL ? Orientation.VERTICAL : Orientation.HORIZONTAL;
  }
  if (root.type !== "branch" || orientation !== Orientation.HORIZONTAL) return [];
  const children = root.data as GridNode[];
  if (children.length < 2) return [];
  const visible = children.filter((child) => child.visible !== false).length;
  return (["left", "right"] as const).map((side) => {
    const child = children[side === "left" ? 0 : children.length - 1]!;
    return { side, ...members(child), width: child.size ?? 0, hidden: child.visible === false, canCollapse: visible > 1 };
  });
}
