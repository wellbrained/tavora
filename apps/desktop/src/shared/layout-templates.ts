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
  { id: "two-columns", name: "Two columns", direction: "row", parts: [1, 1] },
  { id: "three-columns", name: "Three columns", direction: "row", parts: [1, 1, 1] },
  { id: "two-rows", name: "Two rows", direction: "column", parts: [1, 1] },
  { id: "main-sidebar", name: "Main and sidebar", direction: "row", parts: [2, 1] },
  { id: "main-stacked", name: "Main and two stacked", direction: "row", parts: [3, [1, 1]] },
  { id: "grid", name: "Grid of four", direction: "row", parts: [[1, 1], [1, 1]] },
] as const satisfies readonly LayoutTemplate[];

export type LayoutTemplateId = (typeof LAYOUT_TEMPLATES)[number]["id"];

export function layoutTemplate(id: string) {
  return LAYOUT_TEMPLATES.find((template) => template.id === id);
}

/** How many slots a template has. */
export function templateSlots(template: LayoutTemplate): number {
  return template.parts.reduce<number>((sum, part) => sum + (typeof part === "number" ? 1 : part.length), 0);
}
