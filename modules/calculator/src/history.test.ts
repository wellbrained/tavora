import { describe, expect, it } from "vitest";
import { MAX_HISTORY, parseHistory, remember, restoreHistory } from "./history";

describe("history", () => {
  it("keeps only valid entries", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory([{ expression: "1+1", result: "2" }, { expression: 3 }, null, "x"])).toEqual([{ expression: "1+1", result: "2" }]);
  });

  it("puts the newest first and keeps the last few", () => {
    let history = parseHistory(null);
    for (let n = 0; n < MAX_HISTORY + 3; n++) history = remember(history, { expression: `${n}+0`, result: `${n}` });
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]!.result).toBe(`${MAX_HISTORY + 2}`);
  });
  it("keeps the length the player picked", () => {
    let history = parseHistory(null);
    for (let n = 0; n < 30; n++) history = remember(history, { expression: `${n}+0`, result: `${n}` }, 25);
    expect(history).toHaveLength(25);
    expect(remember(history, { expression: "1+1", result: "2" }, 10)).toHaveLength(10);
  });

  it("moves a repeated calculation up instead of keeping it twice", () => {
    const history = remember(remember(remember([], { expression: "1+1", result: "2" }), { expression: "2+2", result: "4" }), { expression: "1+1", result: "2" });
    expect(history.map((item) => item.result)).toEqual(["2", "4"]);
  });
});

describe("restoreHistory", () => {
  const a = { expression: "1+1", result: "2" };
  const b = { expression: "2*3", result: "6" };
  const c = { expression: "9-1", result: "8" };

  it("brings cleared results back under ones worked out since, without twins, keeping the newest", () => {
    expect(restoreHistory([], [a, b])).toEqual([a, b]);
    expect(restoreHistory([c, a], [a, b])).toEqual([c, a, b]);
    expect(restoreHistory([c], [a, b], 2)).toEqual([c, a]);
  });
});
