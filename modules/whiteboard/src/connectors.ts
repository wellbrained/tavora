import type { Arrowhead } from "@excalidraw/excalidraw/element/types";

export type ConnectorKind = "line" | "one-way" | "two-way";

export function connectorHeads(kind: ConnectorKind): { startArrowhead: Arrowhead | null; endArrowhead: Arrowhead | null } {
  return { startArrowhead: kind === "two-way" ? "arrow" : null, endArrowhead: kind === "line" ? null : "arrow" };
}
