import { describe, expect, it } from "vitest";
import { checkMenu } from "./module-menu";

const at = { x: 10, y: 20, width: 28, height: 28 };

describe("checkMenu", () => {
  it("keeps exactly what the module sent, and lists the ids the player can pick", () => {
    const { request, choices } = checkMenu({
      items: [
        { type: "heading", label: "Group" },
        { type: "item", id: "rename", label: "Rename", hint: "F2" },
        { type: "item", id: "up", label: "Move up", disabled: true },
        {
          type: "submenu",
          label: "Color",
          items: [
            { type: "item", id: "color:none", label: "None", color: "transparent", checked: true, radio: true },
            { type: "item", id: "color:red", label: "Red", color: "oklch(0.64 0.2 25)", checked: false, radio: true },
          ],
        },
        { type: "submenu", label: "Later", disabled: true, items: [{ type: "item", id: "later", label: "Soon" }] },
        { type: "separator" },
        { type: "item", id: "delete", label: "Delete group", danger: true },
      ],
      at,
      align: "end",
    });
    expect(request).toEqual({
      items: [
        { type: "heading", label: "Group" },
        { type: "item", id: "rename", label: "Rename", hint: "F2" },
        { type: "item", id: "up", label: "Move up", disabled: true },
        {
          type: "submenu",
          label: "Color",
          items: [
            { type: "item", id: "color:none", label: "None", color: "transparent", checked: true, radio: true },
            { type: "item", id: "color:red", label: "Red", color: "oklch(0.64 0.2 25)", checked: false, radio: true },
          ],
        },
        { type: "submenu", label: "Later", disabled: true, items: [{ type: "item", id: "later", label: "Soon" }] },
        { type: "separator" },
        { type: "item", id: "delete", label: "Delete group", danger: true },
      ],
      at,
      align: "end",
    });
    // Disabled items, and items in a disabled submenu, cannot be the answer.
    expect([...choices].sort()).toEqual(["color:none", "color:red", "delete", "rename"]);
  });

  it("accepts a point for a context menu", () => {
    expect(checkMenu({ items: [{ type: "item", id: "a", label: "A" }], at: { x: 0, y: 0 } }).request.at).toEqual({ x: 0, y: 0 });
  });

  it.each([
    ["no items", { items: [], at }],
    ["unknown entry type", { items: [{ type: "slider", id: "v" }], at }],
    ["unknown field", { items: [{ type: "item", id: "a", label: "A", html: "<b>A</b>" }], at }],
    ["empty label", { items: [{ type: "item", id: "a", label: "  " }], at }],
    ["long label", { items: [{ type: "item", id: "a", label: "x".repeat(81) }], at }],
    ["long hint", { items: [{ type: "item", id: "a", label: "A", hint: "x".repeat(31) }], at }],
    ["bad id", { items: [{ type: "item", id: "a b", label: "A" }], at }],
    ["id twice", { items: [{ type: "item", id: "a", label: "A" }, { type: "item", id: "a", label: "B" }], at }],
    ["colour with a url", { items: [{ type: "item", id: "a", label: "A", color: "url(https://example.com/x.png)" }], at }],
    ["colour with a variable", { items: [{ type: "item", id: "a", label: "A", color: "var(--x)" }], at }],
    ["named colour", { items: [{ type: "item", id: "a", label: "A", color: "red" }], at }],
    ["nested submenu", { items: [{ type: "submenu", label: "A", items: [{ type: "submenu", label: "B", items: [{ type: "item", id: "b", label: "B" }] }] }], at }],
    ["empty submenu", { items: [{ type: "submenu", label: "A", items: [] }], at }],
    ["checked as text", { items: [{ type: "item", id: "a", label: "A", checked: "yes" }], at }],
    ["no position", { items: [{ type: "item", id: "a", label: "A" }] }],
    ["position not a number", { items: [{ type: "item", id: "a", label: "A" }], at: { x: "10", y: 0 } }],
    ["negative size", { items: [{ type: "item", id: "a", label: "A" }], at: { x: 0, y: 0, width: -1 } }],
    ["unknown side", { items: [{ type: "item", id: "a", label: "A" }], at, side: "inside" }],
    ["unknown param", { items: [{ type: "item", id: "a", label: "A" }], at, modal: false }],
  ])("refuses %s", (_name, params) => {
    expect(() => checkMenu(params)).toThrow(expect.objectContaining({ code: "INVALID_PARAMS" }));
  });

  it("refuses more than 100 entries, submenus included", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ type: "item", id: `i${i}`, label: `Item ${i}` }));
    const sub = { type: "submenu", label: "More", items: Array.from({ length: 50 }, (_, i) => ({ type: "item", id: `s${i}`, label: `Sub ${i}` })) };
    expect(() => checkMenu({ items: [...items, sub], at })).toThrow(expect.objectContaining({ code: "INVALID_PARAMS" }));
    expect(() => checkMenu({ items: [...items.slice(1), sub], at })).not.toThrow();
  });
});
