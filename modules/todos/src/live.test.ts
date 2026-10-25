import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLiveState, LIVE_DEFAULTS, LIVE_MAX, parseLook, shorten, throttle } from "./live";
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
const build = (data: TodoList, collapsed: string[] = []) => buildLiveState(data, collapsed, LIVE_DEFAULTS, "+{count} more");

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

  it("shows steps as progress on their parent, not as rows", () => {
    const data = list(
      group("a", [task("p"), task("s1", { parentId: "p", done: true }), task("s2", { parentId: "p" }), task("s3", { parentId: "p", done: true })]),
    );
    expect(build(data).rows).toEqual([{ text: "p", pinned: false, progress: "2/3" }]);
  });

  it("gives a pinned step its own row", () => {
    const data = list(group("a", [task("p"), task("s", { parentId: "p", pinned: true })]));
    expect(build(data).rows.map((r) => r.text)).toEqual(["s", "p"]);
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

  it("carries the look", () => {
    const state = buildLiveState(list(), [], { background: 50, padding: 3 }, "m");
    expect([state.background, state.padding, state.moreText]).toEqual([50, 3, "m"]);
  });
});

describe("parseLook", () => {
  it("defaults to 33 % and 8 px", () => {
    expect(parseLook(undefined)).toEqual({ background: 33, padding: 8 });
    expect(parseLook({ background: "x", padding: NaN })).toEqual({ background: 33, padding: 8 });
  });
  it("keeps 0 and pulls values into range", () => {
    expect(parseLook({ background: 0, padding: 0 })).toEqual({ background: 0, padding: 0 });
    expect(parseLook({ background: 400, padding: -3 })).toEqual({ background: 100, padding: 0 });
    expect(parseLook({ background: 40.6, padding: 30 })).toEqual({ background: 41, padding: 25 });
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
