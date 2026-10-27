import type { JsonValue } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import {
  addGroup,
  addTask,
  canIndent,
  canShift,
  childCount,
  clearDone,
  deleteGroup,
  deleteTask,
  doneState,
  findTask,
  indentTask,
  LIMITS,
  MAX_DEPTH,
  moveGroup,
  moveTask,
  outdentTask,
  parentAtEnd,
  parseList,
  pinnedTasks,
  removedBlock,
  renameGroup,
  restoreBlock,
  restoreDone,
  setDone,
  setGroupColor,
  shiftTask,
  updateTask,
  type TodoList,
} from "./todos";

const AT = "2026-10-14T12:00:00.000Z";

function list(): TodoList {
  const data = parseList(null);
  addGroup(data, "g1", "Bosses");
  addGroup(data, "g2", "Exploration");
  for (const id of ["a", "b", "c"]) addTask(data, "g1", { id, title: id.toUpperCase(), createdAt: AT }, "unused");
  addTask(data, "g2", { id: "d", title: "D", createdAt: AT }, "unused");
  return data;
}

const titles = (data: TodoList, group: number) => data.groups[group]!.tasks.map((task) => task.id).join("");

/** Group g1 as "id(parent)" pairs, so nesting is visible at a glance. */
const tree = (data: TodoList) => data.groups[0]!.tasks.map((task) => (task.parentId ? `${task.id}(${task.parentId})` : task.id)).join(" ");

/** a, with b and c under it and d under c, then e. */
function nested(): TodoList {
  const data = parseList(null);
  addGroup(data, "g1", "Bosses");
  const add = (id: string, parentId: string | null = null) => addTask(data, "g1", { id, title: id, createdAt: AT, parentId }, "x");
  add("a");
  add("b", "a");
  add("c", "a");
  add("d", "c");
  add("e");
  return data;
}

describe("parseList", () => {
  it("gives an empty list for a new workspace or damaged data", () => {
    expect(parseList(null)).toEqual({ version: 2, groups: [] });
    expect(parseList({ groups: "no" })).toEqual({ version: 2, groups: [] });
  });

  it("repairs fields and drops duplicate ids", () => {
    const data = parseList({
      groups: [
        { id: "g", name: "", tasks: [{ id: "t", title: 5, done: true, doneAt: "X" }, { id: "t", title: "dup" }] },
        { id: "g", name: "dup", tasks: [] },
        "junk",
      ],
    });
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]!.name).toBe("To-Dos");
    expect(data.groups[0]!.tasks).toEqual([{ id: "t", title: "", done: true, details: "", pinned: false, parentId: null, createdAt: "", doneAt: "X" }]);
  });

  it("turns an older version's steps into sub-to-dos and its link into details", () => {
    const data = parseList({
      version: 1,
      groups: [
        {
          id: "g",
          name: "G",
          tasks: [
            {
              id: "a",
              title: "A",
              details: "Bring flasks",
              link: "https://example.com/guide",
              createdAt: AT,
              steps: [
                { id: "s1", title: "S1", done: true },
                { id: "s2", title: "S2" },
              ],
            },
            { id: "b", title: "B", link: "https://example.com/b" },
          ],
        },
      ],
    });
    const tasks = data.groups[0]!.tasks;
    expect(tasks.map((task) => [task.id, task.parentId, task.done])).toEqual([
      ["a", null, false],
      ["s1", "a", true],
      ["s2", "a", false],
      ["b", null, false],
    ]);
    expect(tasks.map((task) => task.details)).toEqual(["Bring flasks\nhttps://example.com/guide", "", "", "https://example.com/b"]);
  });

  it("repairs parents that are missing, below the task or too deep", () => {
    const ids = [
      ["a", "c"],
      ["b", "a"],
      ["c", "gone"],
      ["d", "c"],
      ["e", "d"],
      ["f", "e"],
      ["g", "f"],
      ["h", "b"],
    ];
    const data = parseList({ groups: [{ id: "g", name: "G", tasks: ids.map(([id, parentId]) => ({ id: id!, parentId: parentId! })) }] });
    expect(tree(data)).toBe("a b(a) c d(c) e(d) f(e) g(e) h");
  });

  it("limits how much a stored list can hold", () => {
    const many = (count: number, make: (n: number) => JsonValue): JsonValue[] => Array.from({ length: count }, (_, n) => make(n));
    const data = parseList({
      version: 2,
      groups: many(LIMITS.groups + 5, (g) => ({
        id: `g${g}`,
        name: "G",
        tasks: g === 0 ? many(LIMITS.tasksPerGroup + 5, (t) => ({ id: `t${t}`, title: "T" })) : [],
      })),
    });
    expect(data.groups).toHaveLength(LIMITS.groups);
    expect(data.groups[0]!.tasks).toHaveLength(LIMITS.tasksPerGroup);
  });
});

describe("group colors", () => {
  it("start without one, can be set and cleared, and refuse unknown names", () => {
    const data = list();
    expect(data.groups.map((group) => group.color)).toEqual(["", ""]);
    setGroupColor(data, "g1", "blue");
    setGroupColor(data, "g2", "pink");
    expect(data.groups.map((group) => group.color)).toEqual(["blue", "pink"]);
    setGroupColor(data, "g2", "chartreuse");
    setGroupColor(data, "g1", "");
    setGroupColor(data, "missing", "red");
    expect(data.groups.map((group) => group.color)).toEqual(["", ""]);
  });

  it("are read back, and an old list, a wrong type or an unknown name means none", () => {
    const stored = {
      version: 1,
      groups: [
        { id: "a", name: "A", color: "violet", tasks: [] },
        { id: "b", name: "B", tasks: [] },
        { id: "c", name: "C", color: 5, tasks: [] },
        { id: "d", name: "D", color: "Blue", tasks: [] },
        { id: "e", name: "E", color: "url(x)", tasks: [] },
      ],
    };
    expect(parseList(stored as never).groups.map((group) => group.color)).toEqual(["violet", "", "", "", ""]);
  });
});

describe("groups", () => {
  it("are added, renamed, moved and deleted", () => {
    const data = list();
    addGroup(data, "g3", "  Builds  ", 0);
    expect(data.groups.map((group) => group.name)).toEqual(["Builds", "Bosses", "Exploration"]);
    addGroup(data, "g4", "   ");
    addGroup(data, "g3", "Again");
    expect(data.groups).toHaveLength(3);
    renameGroup(data, "g3", "Gear");
    renameGroup(data, "g3", " ");
    moveGroup(data, "g3", 1);
    moveGroup(data, "g2", 5);
    expect(data.groups.map((group) => group.name)).toEqual(["Bosses", "Gear", "Exploration"]);
    deleteGroup(data, "g1");
    expect(data.groups.map((group) => group.id)).toEqual(["g3", "g2"]);
  });
});

describe("tasks", () => {
  it("go into the first group, which is created when there is none", () => {
    const data = parseList(null);
    addTask(data, null, { id: "t", title: " Find the crypt ", createdAt: AT }, "new-group");
    expect(data.groups).toMatchObject([{ id: "new-group", name: "To-Dos", tasks: [{ id: "t", title: "Find the crypt" }] }]);
    addTask(data, "gone", { id: "u", title: "Next", createdAt: AT }, "other");
    expect(titles(data, 0)).toBe("tu");
    addTask(data, null, { id: "t", title: "Same id again", createdAt: AT }, "x");
    addTask(data, null, { id: "v", title: "  ", createdAt: AT }, "x");
    expect(titles(data, 0)).toBe("tu");
  });

  it("are edited, finished and deleted", () => {
    const data = list();
    updateTask(data, "a", { title: "  ", details: "Bring flasks", pinned: true });
    expect(findTask(data, "a")?.task).toMatchObject({ title: "A", details: "Bring flasks", pinned: true });
    expect(pinnedTasks(data).map(({ task }) => task.id)).toEqual(["a"]);

    // Finishing an objective takes it off the objectives.
    setDone(data, "a", true, AT);
    expect(findTask(data, "a")?.task).toMatchObject({ done: true, doneAt: AT, pinned: false });
    setDone(data, "a", false, AT);
    expect(findTask(data, "a")?.task).toMatchObject({ done: false, doneAt: null });

    setDone(data, "b", true, AT);
    clearDone(data, "g1");
    expect(titles(data, 0)).toBe("ac");
    deleteTask(data, "c");
    deleteTask(data, "missing");
    expect(titles(data, 0)).toBe("a");
  });

  it("move inside and between groups", () => {
    const data = list();
    moveTask(data, "a", "g1", null);
    expect(titles(data, 0)).toBe("bca");
    shiftTask(data, "a", -1);
    expect(titles(data, 0)).toBe("bac");
    shiftTask(data, "b", -1);
    expect(titles(data, 0)).toBe("bac");
    moveTask(data, "c", "g2", "d");
    expect([titles(data, 0), titles(data, 1)]).toEqual(["ba", "cd"]);
    moveTask(data, "d", "g1", null);
    expect([titles(data, 0), titles(data, 1)]).toEqual(["bad", "c"]);
    moveTask(data, "d", "gone", null);
    moveTask(data, "d", "g1", "missing");
    expect(titles(data, 0)).toBe("bad");
  });

  it("re-applying a change to a list another panel changed keeps both changes", () => {
    const base = list();
    const mine = (data: TodoList) => addTask(data, "g1", { id: "mine", title: "Mine", createdAt: AT }, "x");
    const theirs = structuredClone(base);
    addTask(theirs, "g1", { id: "theirs", title: "Theirs", createdAt: AT }, "x");
    deleteTask(theirs, "b");
    mine(theirs);
    mine(theirs);
    expect(titles(theirs, 0)).toBe("actheirsmine");
  });
});

describe("sub-to-dos", () => {
  it("are added at the end of their parent's block", () => {
    const data = nested();
    expect(tree(data)).toBe("a b(a) c(a) d(c) e");
    addTask(data, "g1", { id: "f", title: "f", createdAt: AT, parentId: "a" }, "x");
    addTask(data, "g1", { id: "g", title: "g", createdAt: AT, parentId: "gone" }, "x");
    expect(tree(data)).toBe("a b(a) c(a) d(c) f(a) e g");
    expect(childCount(data.groups[0]!.tasks, "a")).toEqual({ done: 0, total: 3 });
  });

  it("are indented under the sibling above and outdented after their parent's block", () => {
    const data = nested();
    indentTask(data, "e");
    expect(tree(data)).toBe("a b(a) c(a) d(c) e(a)");
    indentTask(data, "e");
    expect(tree(data)).toBe("a b(a) c(a) d(c) e(c)");
    // The first task of a level has no sibling above to go under.
    indentTask(data, "a");
    indentTask(data, "b");
    expect(tree(data)).toBe("a b(a) c(a) d(c) e(c)");

    outdentTask(data, "b");
    // b leaves a's block; the tasks that were below it stay under a.
    expect(tree(data)).toBe("a c(a) d(c) e(c) b");
    outdentTask(data, "b");
    expect(tree(data)).toBe("a c(a) d(c) e(c) b");
  });

  it("are not nested deeper than MAX_DEPTH", () => {
    const data = parseList(null);
    addGroup(data, "g1", "G");
    let parent: string | null = null;
    for (let depth = 0; depth <= MAX_DEPTH + 1; depth++) {
      addTask(data, "g1", { id: `t${depth}`, title: "T", createdAt: AT, parentId: parent }, "x");
      parent = `t${depth}`;
    }
    const group = data.groups[0]!;
    expect(group.tasks.at(-1)!.parentId).toBe(`t${MAX_DEPTH - 1}`);
    // u sits under t1 next to t2, whose block reaches the deepest level.
    addTask(data, "g1", { id: "u", title: "U", createdAt: AT, parentId: "t1" }, "x");
    const u = () => group.tasks.findIndex((task) => task.id === "u");
    expect(canIndent(group, u())).toBe(true);
    indentTask(data, "u");
    expect(findTask(data, "u")?.task.parentId).toBe("t2");
    // Under t2 now; going under t3 would be one level too deep.
    expect(canIndent(group, u())).toBe(false);
  });

  it("move with their parent", () => {
    const data = nested();
    shiftTask(data, "e", -1);
    expect(tree(data)).toBe("e a b(a) c(a) d(c)");
    shiftTask(data, "a", -1);
    expect(tree(data)).toBe("a b(a) c(a) d(c) e");
    shiftTask(data, "b", 1);
    expect(tree(data)).toBe("a c(a) d(c) b(a) e");
    // Siblings only: b is the last under a, so it cannot move down past e.
    shiftTask(data, "b", 1);
    expect(tree(data)).toBe("a c(a) d(c) b(a) e");
    const group = data.groups[0]!;
    expect([canShift(group, 3, 1), canShift(group, 3, -1), canShift(group, 0, -1)]).toEqual([false, true, false]);

    moveTask(data, "c", "g1", "e");
    expect(tree(data)).toBe("a b(a) c d(c) e");
    moveTask(data, "a", "g1", "b");
    expect(tree(data)).toBe("a b(a) c d(c) e");
    addGroup(data, "g2", "Other");
    moveTask(data, "a", "g2", null);
    expect(tree(data)).toBe("c d(c) e");
    expect(data.groups[1]!.tasks.map((task) => task.parentId)).toEqual([null, "a"]);
  });

  it("are finished with their parent; reopening one reopens its parents", () => {
    const data = nested();
    updateTask(data, "d", { pinned: true });
    const before = doneState(data, "a");
    setDone(data, "a", true, AT);
    expect(data.groups[0]!.tasks.filter((task) => task.done).map((task) => task.id)).toEqual(["a", "b", "c", "d"]);
    expect(findTask(data, "d")?.task.pinned).toBe(false);
    setDone(data, "d", false, AT);
    expect(data.groups[0]!.tasks.filter((task) => task.done).map((task) => task.id)).toEqual(["b"]);

    restoreDone(data, before);
    expect(data.groups[0]!.tasks.filter((task) => task.done)).toEqual([]);
    expect(findTask(data, "d")?.task.pinned).toBe(true);
  });

  it("are deleted and cleared with their parent, and a deletion can be put back", () => {
    const data = nested();
    const removed = removedBlock(data, "c")!;
    deleteTask(data, "c");
    expect(tree(data)).toBe("a b(a) e");
    restoreBlock(data, removed);
    restoreBlock(data, removed);
    expect(tree(data)).toBe("a b(a) c(a) d(c) e");

    setDone(data, "c", true, AT);
    clearDone(data, "g1");
    expect(tree(data)).toBe("a b(a) e");
  });

  it("can be added at the end at any level the last task allows", () => {
    const data = nested();
    const group = data.groups[0]!;
    expect([0, 1, 2].map((level) => parentAtEnd(group, level))).toEqual([null, "e", "e"]);
    deleteTask(data, "e");
    expect([0, 1, 2, 3, 4].map((level) => parentAtEnd(group, level))).toEqual([null, "a", "c", "d", "d"]);
  });
});
