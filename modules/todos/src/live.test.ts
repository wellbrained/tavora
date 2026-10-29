import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveState, LIVE_DEFAULTS, LIVE_MAX, PANEL_LOOK_DEFAULTS, parseLook, parsePanelLook, shorten, throttle, type LiveLook } from "./live";
import type { Group, Task, TodoList } from "./todos";

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  done: false,
  details: "",
  pinned: false,
  parentId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  doneAt: null,
  ...extra,
});
const group = (id: string, tasks: Task[]): Group => ({ id, name: id, color: "", tasks });
const list = (...groups: Group[]): TodoList => ({ version: 2, groups });
const TEXTS = { more: "+{count} more", objectives: "Objectives" };
const NO_HEADERS: LiveLook = { ...LIVE_DEFAULTS, headers: "none" };
const build = (data: TodoList, collapsed: string[] = [], look: LiveLook = NO_HEADERS) => buildLiveState(data, collapsed, look, TEXTS);

describe("buildLiveState", () => {
  it("is empty without groups or tasks", () => {
    expect(build(list()).rows).toEqual([]);
    expect(build(list(group("a", []))).more).toBe(0);
  });

  it("hides finished to-dos", () => {
    expect(build(list(group("a", [task("x", { done: true }), task("y")]))).rows.map((r) => r.text)).toEqual(["y"]);
  });

  it("puts pinned first, then list order", () => {
    const data = list(group("a", [task("a1"), task("a2", { pinned: true })]), group("b", [task("b1"), task("b2", { pinned: true })]));
    expect(build(data).rows.map((r) => [r.text, r.pinned])).toEqual([["a2", true], ["b2", true], ["a1", false], ["b1", false]]);
  });

  it("leaves out folded groups but keeps their pinned to-dos", () => {
    const data = list(group("a", [task("a1"), task("a2", { pinned: true })]), group("b", [task("b1")]));
    expect(build(data, ["a"]).rows.map((r) => r.text)).toEqual(["a2", "b1"]);
  });

  it("shows open steps indented under their parent, with its progress", () => {
    const data = list(
      group("a", [task("p"), task("s1", { parentId: "p", done: true }), task("s2", { parentId: "p" }), task("s3", { parentId: "p", done: true })]),
    );
    expect(build(data).rows).toEqual([
      { kind: "task", text: "p", pinned: false, done: false, progress: "2/3", depth: 0 },
      { kind: "task", text: "s2", pinned: false, done: false, progress: null, depth: 1 },
    ]);
  });

  it("shows every level and hides what sits under a finished to-do", () => {
    const data = list(
      group("a", [task("p"), task("s", { parentId: "p" }), task("ss", { parentId: "s" }), task("d", { parentId: "p", done: true }), task("dd", { parentId: "d" })]),
    );
    expect(build(data).rows.map((r) => [r.text, r.depth])).toEqual([["p", 0], ["s", 1], ["ss", 2]]);
  });

  it("keeps steps of a folded group out, but shows its pinned step", () => {
    const data = list(group("a", [task("p"), task("s", { parentId: "p" }), task("q", { parentId: "p", pinned: true })]));
    expect(build(data, ["a"]).rows.map((r) => r.text)).toEqual(["q"]);
  });

  it("gives a pinned step its own row at the top, not repeated below", () => {
    const data = list(group("a", [task("p"), task("s", { parentId: "p", pinned: true })]));
    expect(build(data).rows.map((r) => [r.text, r.depth])).toEqual([["s", 0], ["p", 0]]);
  });

  it("shortens long and multi-line text", () => {
    expect(shorten("a\n  b")).toBe("a b");
    const out = shorten("x".repeat(500));
    expect(Array.from(out)).toHaveLength(LIVE_MAX.text);
    expect(out.endsWith("…")).toBe(true);
  });

  it("caps the rows and counts the rest", () => {
    const tasks = Array.from({ length: LIVE_MAX.rows + 7 }, (_, i) => task(`t${i}`));
    const state = build(list(group("a", tasks)));
    expect(state.rows).toHaveLength(LIVE_MAX.rows);
    expect(state.more).toBe(7);
  });

  it("stays well under 16 KB in the worst case", () => {
    const tasks = Array.from({ length: 200 }, (_, i) => task(`t${i}`, { title: "😀".repeat(500), pinned: i % 2 === 0 }));
    const bytes = new TextEncoder().encode(JSON.stringify(build(list(group("a", tasks))))).length;
    expect(bytes).toBeLessThan(16 * 1024 * 0.9);
  });

  it("carries the look and the more text", () => {
    const look = { ...LIVE_DEFAULTS, background: 50, padding: 3 };
    const state = build(list(), [], look);
    expect([state.look, state.moreText]).toEqual([look, TEXTS.more]);
  });

  it("shows finished to-dos, and what sits under them, when the look asks for it", () => {
    const data = list(group("a", [task("p", { done: true }), task("s", { parentId: "p", done: true }), task("q")]));
    const state = build(data, [], { ...NO_HEADERS, showFinished: true });
    expect(state.rows.map((r) => r.kind === "task" && [r.text, r.done, r.depth])).toEqual([
      ["p", true, 0],
      ["s", true, 1],
      ["q", false, 0],
    ]);
  });

  it("starts each group, and the objectives, with a heading", () => {
    const data = list(group("a", [task("a1"), task("a2", { pinned: true })]), group("b", []), group("c", [task("c1")]));
    expect(build(data, [], LIVE_DEFAULTS).rows.map((r) => [r.kind, r.text])).toEqual([
      ["group", "Objectives"],
      ["task", "a2"],
      ["group", "a"],
      ["task", "a1"],
      ["group", "c"],
      ["task", "c1"],
    ]);
  });

  it("never ends on a heading and counts only to-dos as more", () => {
    const tasks = Array.from({ length: LIVE_MAX.rows - 2 }, (_, i) => task(`t${i}`));
    const state = build(list(group("a", tasks), group("b", [task("b1"), task("b2")])), [], LIVE_DEFAULTS);
    // Heading a, 38 to-dos, then heading b would be row 40: it is dropped with b1 and b2.
    expect(state.rows.at(-1)!.kind).toBe("task");
    expect(state.rows).toHaveLength(LIVE_MAX.rows - 1);
    expect(state.more).toBe(2);
  });
});

describe("parseLook", () => {
  const numbers = (raw: Record<string, unknown>) => {
    const look = parseLook(raw);
    return { background: look.background, padding: look.padding };
  };

  it("defaults everything", () => {
    expect(parseLook(undefined)).toEqual(LIVE_DEFAULTS);
    expect(parseLook({ font: "comic", size: "huge", bold: 1, color: "red", headers: "x", backgroundColor: "#12345" })).toEqual(LIVE_DEFAULTS);
    expect(numbers({ background: "x", padding: NaN })).toEqual({ background: 35, padding: 8 });
  });

  it("keeps what is valid", () => {
    const look = { font: "cinzel", size: "xl", bold: true, color: "#facc15", outline: false, headers: "line", showFinished: true, backgroundColor: "#112233", background: 0, padding: 0 };
    expect(parseLook(look)).toEqual(look);
    expect(parseLook({ color: "#FACC15" }).color).toBe("#facc15");
  });

  it("reads the two settings the version before kept", () => {
    expect(numbers({ background: 60, padding: 4 })).toEqual({ background: 60, padding: 4 });
  });

  it("pulls numbers into range", () => {
    expect(numbers({ background: 400, padding: -3 })).toEqual({ background: 100, padding: 0 });
    expect(numbers({ background: 40.6, padding: 30 })).toEqual({ background: 41, padding: 25 });
  });
});

describe("throttle", () => {
  afterEach(() => vi.useRealTimers());

  it("sends the first call at once and ends a burst with the last", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const fn = throttle(send, 250);
    fn(1);
    fn(2);
    fn(3);
    expect(send.mock.calls).toEqual([[1]]);
    vi.advanceTimersByTime(250);
    expect(send.mock.calls).toEqual([[1], [3]]);
  });

  it("cancel drops a waiting call", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const fn = throttle(send, 250);
    fn(1);
    fn(2);
    fn.cancel();
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("parsePanelLook", () => {
  it("keeps a stored font and size", () => {
    expect(parsePanelLook({ font: "cinzel", size: "xl" })).toEqual({ font: "cinzel", size: "xl" });
  });

  it("falls back for panels saved before, or with unknown values", () => {
    expect(parsePanelLook(undefined)).toEqual(PANEL_LOOK_DEFAULTS);
    expect(parsePanelLook({ font: "comic", size: "huge" })).toEqual(PANEL_LOOK_DEFAULTS);
  });
});
