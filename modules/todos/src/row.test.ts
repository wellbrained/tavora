import { describe, expect, it } from "vitest";
import { rowChange, rowMenu, type RowMenuEntry } from "./row";
import { addGroup, addTask, findTask, parseList, type TodoList } from "./todos";

function sample(): TodoList {
  const data = parseList(null);
  addGroup(data, "a", "Main");
  addGroup(data, "b", "Side");
  const at = "2026-11-18T10:00:00.000Z";
  addTask(data, "a", { id: "t1", title: "Find the crypt", createdAt: at, parentId: null }, "x");
  addTask(data, "a", { id: "t2", title: "Light the torch", createdAt: at, parentId: null }, "x");
  return data;
}

const ids = (entries: RowMenuEntry[]) => entries.map((entry) => (entry.type === "item" ? entry.id : entry.type));
const menuFor = (data: TodoList, taskId: string, extra: { compact?: boolean; rename?: boolean; describe?: boolean } = {}) => {
  const { task, group, index } = findTask(data, taskId)!;
  return rowMenu({ task, group, groups: data.groups, index, depth: 0, ...extra });
};

describe("rowMenu", () => {
  it("is the panel row's menu: description, pin, new to-dos, nesting, moving, then delete", () => {
    expect(ids(menuFor(sample(), "t2"))).toEqual(["describe", "pin", "add-below", "add-sub", "separator", "indent", "outdent", "up", "down", "submenu", "separator", "delete"]);
  });

  it("offers rename and leaves out the description over the game", () => {
    expect(ids(menuFor(sample(), "t1", { rename: true, describe: false })).slice(0, 2)).toEqual(["rename", "pin"]);
  });

  it("keeps an objective's menu short, as in the panel's objectives", () => {
    expect(ids(menuFor(sample(), "t1", { compact: true }))).toEqual(["describe", "pin", "separator", "delete"]);
  });

  it("says why a move is off, and lists the other groups to move to", () => {
    const entries = menuFor(sample(), "t1");
    const item = (id: string) => entries.find((entry) => entry.type === "item" && entry.id === id) as Extract<RowMenuEntry, { type: "item" }>;
    expect(item("indent")).toMatchObject({ disabled: true, disabledReason: expect.any(String) });
    expect(item("outdent").disabled).toBe(true);
    expect(item("up").disabled).toBe(true);
    expect(item("down").disabled).toBe(false);
    const sub = entries.find((entry) => entry.type === "submenu") as Extract<RowMenuEntry, { type: "submenu" }>;
    expect(sub.items.map((entry) => [entry.id, entry.label])).toEqual([["move:b", "Side"]]);
  });
});

describe("rowChange", () => {
  it("pins, nests, moves and moves to another group on the list it gets", () => {
    const data = sample();
    const task = () => findTask(data, "t2")!.task;
    rowChange("pin", task())!(data);
    expect(task().pinned).toBe(true);
    rowChange("indent", task())!(data);
    expect(task().parentId).toBe("t1");
    rowChange("outdent", task())!(data);
    rowChange("up", task())!(data);
    expect(findTask(data, "t2")!.index).toBe(0);
    rowChange("move:b", task())!(data);
    expect(findTask(data, "t2")!.group.id).toBe("b");
  });

  it("leaves what the row carries out itself", () => {
    const { task } = findTask(sample(), "t1")!;
    for (const action of ["rename", "describe", "add-below", "add-sub", "delete"] as const) expect(rowChange(action, task)).toBeNull();
  });
});
