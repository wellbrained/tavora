import type { JsonValue } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import {
  addGroup,
  addStep,
  addTask,
  clearDone,
  deleteGroup,
  deleteStep,
  deleteTask,
  findTask,
  moveGroup,
  moveTask,
  LIMITS,
  normalizeLink,
  parseList,
  pinnedTasks,
  renameGroup,
  setDone,
  shiftTask,
  updateStep,
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

describe("parseList", () => {
  it("gives an empty list for a new game or damaged data", () => {
    expect(parseList(null)).toEqual({ version: 1, groups: [] });
    expect(parseList({ groups: "no" })).toEqual({ version: 1, groups: [] });
  });

  it("repairs fields and drops duplicate ids", () => {
    const data = parseList({
      groups: [
        { id: "g", name: "", tasks: [{ id: "t", title: 5, done: true, doneAt: "X", steps: [{ id: "s", title: "S", done: 1 }] }, { id: "t", title: "dup" }] },
        { id: "g", name: "dup", tasks: [] },
        "junk",
      ],
    });
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]!.name).toBe("To-Dos");
    expect(data.groups[0]!.tasks).toEqual([
      { id: "t", title: "", done: true, details: "", link: "", pinned: false, steps: [{ id: "s", title: "S", done: false }], createdAt: "", doneAt: "X" },
    ]);
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
    updateTask(data, "a", { title: "  ", details: "Bring flasks", link: " https://example.com ", pinned: true });
    expect(findTask(data, "a")?.task).toMatchObject({ title: "A", details: "Bring flasks", link: "https://example.com", pinned: true });
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
    moveTask(data, "a", "g1", 2);
    expect(titles(data, 0)).toBe("bca");
    shiftTask(data, "a", -1);
    expect(titles(data, 0)).toBe("bac");
    shiftTask(data, "b", -1);
    expect(titles(data, 0)).toBe("bac");
    moveTask(data, "c", "g2", 0);
    expect([titles(data, 0), titles(data, 1)]).toEqual(["ba", "cd"]);
    moveTask(data, "d", "g1", 99);
    expect([titles(data, 0), titles(data, 1)]).toEqual(["bad", "c"]);
    moveTask(data, "d", "gone", 0);
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

describe("steps", () => {
  it("are added, ticked, renamed and deleted", () => {
    const data = list();
    addStep(data, "a", "s1", " Reach level 30 ");
    addStep(data, "a", "s2", "Get cold resistance");
    addStep(data, "a", "s1", "duplicate");
    addStep(data, "a", "s3", " ");
    updateStep(data, "a", "s1", { done: true, title: "Reach level 31" });
    updateStep(data, "a", "s2", { title: "  " });
    deleteStep(data, "a", "s2");
    expect(findTask(data, "a")?.task.steps).toEqual([{ id: "s1", title: "Reach level 31", done: true }]);
  });
});

describe("normalizeLink", () => {
  it("keeps web addresses only", () => {
    expect(normalizeLink("")).toBe("");
    expect(normalizeLink("maxroll.gg/poe2")).toBe("https://maxroll.gg/poe2");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("mailto:a@b.c")).toBeNull();
  });
});

describe("parseList hardening", () => {
  it("keeps only web addresses as links", () => {
    const data = parseList({
      version: 1,
      groups: [
        {
          id: "g",
          name: "G",
          tasks: [
            { id: "a", title: "A", link: "javascript:alert(1)" },
            { id: "b", title: "B", link: "https://example.com/guide" },
            { id: "c", title: "C", link: "data:text/html,x" },
            { id: "d", title: "D", link: "example.com" },
          ],
        },
      ],
    });
    expect(data.groups[0]!.tasks.map((task) => task.link)).toEqual(["", "https://example.com/guide", "", "https://example.com/"]);
  });

  it("limits how much a stored list can hold", () => {
    const many = (count: number, make: (n: number) => JsonValue): JsonValue[] => Array.from({ length: count }, (_, n) => make(n));
    const data = parseList({
      version: 1,
      groups: many(LIMITS.groups + 5, (g) => ({
        id: `g${g}`,
        name: "G",
        tasks: g === 0 ? many(LIMITS.tasksPerGroup + 5, (t) => ({ id: `t${t}`, title: "T", steps: many(LIMITS.stepsPerTask + 5, (s) => ({ id: `s${s}`, title: "S" })) })) : [],
      })),
    });
    expect(data.groups).toHaveLength(LIMITS.groups);
    expect(data.groups[0]!.tasks).toHaveLength(LIMITS.tasksPerGroup);
    expect(data.groups[0]!.tasks[0]!.steps).toHaveLength(LIMITS.stepsPerTask);
  });
});
