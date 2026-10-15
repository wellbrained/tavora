// Layout templates: common arrangements of empty slots to start a workspace
// from. Shared, so the host UI can list them and the main process can build
// them; it must not import Electron or Node.

/**
 * One child of a template's root: a slot of that relative size, or a split
 * of slots (running the other way) with these relative sizes. The split's own
 * size is the sum of its slots'.
 */
export type TemplatePart = number | readonly number[];

export interface LayoutTemplate {
  id: string;
  name: string;
  /** "row" places the root's parts side by side, "column" stacks them. */
  direction: "row" | "column";
  parts: readonly TemplatePart[];
}

export const LAYOUT_TEMPLATES = [
  { id: "two-columns", name: "2 columns", direction: "row", parts: [1, 1] },
  { id: "three-columns", name: "3 columns", direction: "row", parts: [1, 1, 1] },
  { id: "four-columns", name: "4 columns", direction: "row", parts: [1, 1, 1, 1] },
  { id: "two-rows", name: "2 rows", direction: "column", parts: [1, 1] },
  { id: "three-rows", name: "3 rows", direction: "column", parts: [1, 1, 1] },
  { id: "grid", name: "2 × 2 grid", direction: "row", parts: [[1, 1], [1, 1]] },
  { id: "main-sidebar", name: "Main + side", direction: "row", parts: [2, 1] },
  { id: "sidebar-main", name: "Side + main", direction: "row", parts: [1, 2] },
  { id: "main-stacked", name: "Main + 2 stacked", direction: "row", parts: [3, [1, 1]] },
  { id: "top-two", name: "Top + 2 below", direction: "column", parts: [1, [1, 1]] },
  { id: "grid-three-two", name: "3 × 2 grid", direction: "row", parts: [[1, 1], [1, 1], [1, 1]] },
  { id: "grid-two-three", name: "2 × 3 grid", direction: "row", parts: [[1, 1, 1], [1, 1, 1]] },
] as const satisfies readonly LayoutTemplate[];

export type LayoutTemplateId = (typeof LAYOUT_TEMPLATES)[number]["id"];

export function layoutTemplate(id: string) {
  return LAYOUT_TEMPLATES.find((template) => template.id === id);
}

/** A part's share of its template, relative to the other parts. */
export const templateWeight = (part: TemplatePart): number => (typeof part === "number" ? part : part.reduce<number>((sum, value) => sum + value, 0));

/** Where a template's slots are, as fractions (0 to 1) of the area it fills; for previews. */
export function templateRects(template: LayoutTemplate): { x: number; y: number; width: number; height: number }[] {
  const row = template.direction === "row";
  const total = template.parts.reduce<number>((sum, part) => sum + templateWeight(part), 0);
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  let along = 0;
  for (const part of template.parts) {
    const share = templateWeight(part) / total;
    const slots = typeof part === "number" ? [1] : part;
    const sum = slots.reduce((acc, value) => acc + value, 0);
    let across = 0;
    for (const value of slots) {
      const size = value / sum;
      rects.push(row ? { x: along, y: across, width: share, height: size } : { x: across, y: along, width: size, height: share });
      across += size;
    }
    along += share;
  }
  return rects;
}
