import { describe, expect, it } from "vitest";
import { copyText, EMPTY, evaluate, format, insert, press, pretty, reference, segments, type Entry, type Lookup } from "./calc";

const value = (text: string) => {
  const outcome = evaluate(text);
  return outcome.ok ? format(outcome.value) : outcome.reason;
};

const type = (keys: string[], from: Entry = EMPTY) => keys.reduce(press, from).text;

describe("evaluate", () => {
  it("does × and ÷ before + and −", () => {
    expect(value("2+3*4")).toBe("14");
    expect(value("10-4/2")).toBe("8");
    expect(value("(2+3)*4")).toBe("20");
  });

  it("reads negatives, percent and brackets next to a number", () => {
    expect(value("-3*-2")).toBe("6");
    expect(value("50%")).toBe("0.5");
    expect(value("200*15%")).toBe("30");
    expect(value("200+10%")).toBe("220");
    expect(value("200-10%")).toBe("180");
    expect(value("200+10%*2")).toBe("200.2");
    expect(value("2(3+4)")).toBe("14");
  });

  it("closes brackets left open", () => {
    expect(value("(2+3")).toBe("5");
  });

  it("rounds away float noise", () => {
    expect(value("0.1+0.2")).toBe("0.3");
    expect(value("1/3")).toBe("0.333333333333");
  });

  it("tells why it can't work something out", () => {
    expect(value("")).toBe("incomplete");
    expect(value("2+")).toBe("incomplete");
    expect(value("5/0")).toBe("divide");
    expect(value("5/(2-2)")).toBe("divide");
    expect(value("2)")).toBe("invalid");
    expect(value("abc")).toBe("invalid");
    expect(value("1e308*10")).toBe("tooBig");
  });

  it("reads its own results back", () => {
    expect(value(`${format(1e21)}*2`)).toBe("2e+21");
  });
});

describe("press", () => {
  it("replaces an operator typed twice", () => {
    expect(type(["5", "+", "*", "2"])).toBe("5*2");
  });

  it("allows a minus after × or ÷ for a negative number", () => {
    expect(type(["5", "*", "-", "2"])).toBe("5*-2");
    expect(type(["5", "*", "-", "+"])).toBe("5+");
  });

  it("starts a number at 0. and keeps one point per number", () => {
    expect(type([".", "5", ".", "+", "."])).toBe("0.5+0.");
  });

  it("only closes brackets that are open", () => {
    expect(type([")", "(", "2", ")", ")"])).toBe("(2)");
    expect(type(["2", "(", "3"])).toBe("2*(3");
  });

  it("starts over on a digit after a result, and goes on with an operator", () => {
    const done: Entry = { text: "42", fresh: true };
    expect(type(["7"], done)).toBe("7");
    expect(type(["+", "1"], done)).toBe("42+1");
  });

  it("deletes the last key and clears", () => {
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["1", "clear"])).toBe("");
  });
});

describe("insert", () => {
  it("adds a number after an operator and replaces otherwise", () => {
    expect(insert({ text: "5+", fresh: false }, "3").text).toBe("5+3");
    expect(insert({ text: "5+", fresh: false }, "-3").text).toBe("5+(-3)");
    expect(insert({ text: "5", fresh: false }, "3")).toEqual({ text: "3", fresh: true });
  });
});

describe("pretty", () => {
  it("shows the signs a player knows", () => {
    expect(pretty("-2*3/4")).toBe("−2×3÷4");
    expect(pretty("1.5+2", true)).toBe("1,5+2");
  });

  it("groups thousands, not decimals", () => {
    expect(pretty("1234567.12345+999")).toBe("1,234,567.12345+999");
    expect(pretty("1234567.5", true)).toBe("1.234.567,5");
    expect(pretty("1000.")).toBe("1,000.");
  });
});

describe("square, root and sign", () => {
  it("work on the number just typed", () => {
    expect(type(["2", "+", "9", "sqrt"])).toBe("2+√(9)");
    expect(type(["2", "+", "3", "square"])).toBe("2+3²");
    expect(type(["2", "*", "3", "negate"])).toBe("2*-3");
    expect(type(["2", "*", "3", "negate", "negate"])).toBe("2*3");
  });

  it("turn a plus into a minus and back", () => {
    expect(type(["5", "+", "3", "negate"])).toBe("5-3");
    expect(type(["5", "-", "3", "negate"])).toBe("5+3");
  });

  it("work on the bracket just closed", () => {
    expect(type(["(", "2", "+", "3", ")", "square"])).toBe("(2+3)²");
    expect(type(["(", "2", "+", "3", ")", "sqrt"])).toBe("√(2+3)");
    expect(type(["2", "*", "(", "1", ")", "+", "(", "4", ")", "negate"])).toBe("2*(1)-(4)");
  });

  it("work on the result after =", () => {
    const done: Entry = { text: "-3", fresh: true };
    expect(type(["square"], done)).toBe("(-3)²");
    expect(type(["sqrt"], { text: "16", fresh: true })).toBe("√(16)");
    expect(type(["negate"], done)).toBe("3");
  });

  it("do nothing after an operator; ± on nothing starts a minus", () => {
    expect(type(["5", "+", "sqrt", "square"])).toBe("5+");
    expect(type(["negate", "4"])).toBe("-4");
  });

  it("add up", () => {
    expect(value("√(9)+3²")).toBe("12");
    expect(value("(-3)²")).toBe("9");
    expect(value("-3²")).toBe("-9");
    expect(value("2√(16)")).toBe("8");
    expect(value("√(2+2)²")).toBe("4");
    expect(value("√(-4)")).toBe("negativeRoot");
    expect(type(["3", "square", "2"])).toBe("3²*2");
  });
});

describe("copyText", () => {
  it("is the plain result, no grouping", () => {
    expect(copyText({ text: "1000*1.5", fresh: false })).toBe("1500");
    expect(copyText({ text: "1234.5", fresh: true }, true)).toBe("1234,5");
    expect(copyText({ text: "2+", fresh: false })).toBeNull();
  });
});

describe("k, m and b", () => {
  it("count thousands, millions and billions", () => {
    expect(value("5k")).toBe("5000");
    expect(value("2.5m+1K")).toBe("2501000");
    expect(value("1b/4")).toBe("250000000");
  });

  it("follow a number once, and a number after them multiplies", () => {
    expect(type(["5", "k", "m"])).toBe("5m");
    expect(type(["+", "k", "(", "k"])).toBe("(");
    expect(type(["2", "k", "3"])).toBe("2k*3");
    expect(type(["2", "k", "square"])).toBe("2k²");
  });
});

describe("round up", () => {
  it("works on the number, the bracket or the result", () => {
    expect(type(["7", "/", "2", "ceil"])).toBe("7/⌈2⌉");
    expect(type(["(", "7", "/", "2", ")", "ceil"])).toBe("⌈7/2⌉");
    expect(type(["ceil"], { text: "3.5", fresh: true })).toBe("⌈3.5⌉");
  });

  it("rounds up what shows, not float noise", () => {
    expect(value("⌈7/2⌉")).toBe("4");
    expect(value("⌈-3.5⌉")).toBe("-3");
    expect(value("⌈0.1*3*10⌉")).toBe("3");
    expect(value("2⌈1.2⌉")).toBe("4");
    expect(value("⌈1.2")).toBe("2");
  });

  it("goes as a whole with Delete last", () => {
    expect(type(["back"], { text: "5+⌈7/2⌉", fresh: false })).toBe("5+7/2");
  });
});

describe("saved values", () => {
  const values: Lookup = (name) => ({ iron: 100, copper: 2.5 })[name.toLowerCase()];

  it("are worked out with their number now", () => {
    expect(evaluate("[iron]*2+[Copper]", values)).toEqual({ ok: true, value: 202.5 });
    expect(copyText({ text: "[copper]", fresh: false }, true, values)).toBe("2,5");
  });

  it("can't be found once deleted", () => {
    expect(evaluate("[gold]+1", values)).toEqual({ ok: false, reason: "missing" });
    expect(evaluate("[iron]")).toEqual({ ok: false, reason: "missing" });
  });

  it("are tapped in like a number", () => {
    expect(reference(EMPTY, "iron").text).toBe("[iron]");
    expect(reference({ text: "5+", fresh: false }, "iron").text).toBe("5+[iron]");
    expect(reference({ text: "2", fresh: false }, "iron").text).toBe("2*[iron]");
    expect(reference({ text: "42", fresh: true }, "iron").text).toBe("[iron]");
    expect(type(["3"], reference(EMPTY, "iron"))).toBe("[iron]*3");
    expect(type(["sqrt"], reference(EMPTY, "iron"))).toBe("√[iron]");
    expect(type(["back"], { text: "2*[iron]", fresh: false })).toBe("2*");
  });

  it("show by name, without grouping the name's digits", () => {
    expect(pretty("1000*[iron1000]")).toBe("1,000×iron1000");
    expect(segments("2*[iron]")).toEqual([{ text: "2×" }, { text: "iron", name: "iron" }]);
  });
});
