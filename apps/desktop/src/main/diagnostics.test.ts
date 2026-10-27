import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendStartupLog, buildReport, ErrorLog, scrub, Timings } from "./diagnostics";

const folders = { home: "C:\\Users\\Alex", userData: "C:\\Users\\Alex\\AppData\\Roaming\\@tavora\\desktop" };

describe("appendStartupLog", () => {
  const logFile = () => path.join(mkdtempSync(path.join(tmpdir(), "tavora-log-")), "logs", "startup.log");

  it("creates the log and its folder, one line per failure, folders scrubbed", () => {
    const file = logFile();
    appendStartupLog(file, `refused --no-sandbox\nin ${folders.userData}`, folders, new Date("2026-10-17T12:00:00Z"));
    expect(readFileSync(file, "utf8")).toBe("2026-10-17T12:00:00.000Z refused --no-sandbox in <data>\n");
  });

  it("keeps only the newest 50 lines", () => {
    const file = logFile();
    for (let i = 1; i <= 55; i++) appendStartupLog(file, `failure ${i}`);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(50);
    expect(lines[0]).toContain("failure 6");
    expect(lines[49]).toContain("failure 55");
  });
});

describe("scrub", () => {
  it("hides the data folder, the home folder and any other user name", () => {
    const text = [
      "read C:\\Users\\Alex\\AppData\\Roaming\\@tavora\\desktop\\library.json failed",
      "C:/Users/Alex/Documents/x.png",
      "C:\\\\Users\\\\Alex\\\\a",
      "at C:\\Users\\Someone Else\\a.js",
      "/Users/jo/Library/x and /home/ann/x",
    ].join("\n");
    const out = scrub(text, folders);
    expect(out).not.toMatch(/Alex|Someone|jo\/|ann\//);
    expect(out).toContain("<data>\\library.json");
    expect(out).toContain("<home>/Documents/x.png");
  });
});

describe("ErrorLog", () => {
  it("keeps the newest lines, with the error's message and a few stack lines", () => {
    const log = new ErrorLog();
    for (let i = 0; i < 30; i++) log.add("error", [`[tavora] failed ${i}`]);
    log.add("warn", ["boom", new Error("bad thing")]);
    const lines = log.recent();
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain("failed 11");
    expect(lines.at(-1)).toMatch(/ warn boom Error: bad thing \| /);
  });

  it("records what console.error and console.warn print, and still prints it", () => {
    const printed: unknown[][] = [];
    const fake = { error: (...args: unknown[]) => printed.push(args), warn: (...args: unknown[]) => printed.push(args) };
    const log = new ErrorLog();
    log.capture(fake);
    fake.error("one");
    fake.warn("two");
    expect(printed).toEqual([["one"], ["two"]]);
    expect(log.recent().map((line) => line.split(" ").slice(1).join(" "))).toEqual(["error one", "warn two"]);
  });
});

describe("Timings", () => {
  it("summarises the latest samples", () => {
    const timings = new Timings();
    for (const ms of [10, 30, 20, 500]) timings.record("game-switch", ms);
    expect(timings.summary()).toEqual([{ name: "game-switch", count: 4, last: 500, median: 30, max: 500 }]);
  });
});

describe("buildReport", () => {
  it("lists versions, timings, updates and errors without the player's folders", () => {
    const timings = new Timings();
    timings.record("startup", 900);
    const report = buildReport({
      version: "0.5.2",
      packaged: true,
      electron: "40.0.0",
      chrome: "140.0",
      locale: "en-US",
      osName: "Windows 11 Pro",
      workspaces: 3,
      panels: 2,
      updateLog: ["2026-10-15T10:00:00Z update 0.5.3 available"],
      errors: ["2026-10-15T10:01:00Z error could not read C:\\Users\\Alex\\x"],
      timings: timings.summary(),
      uptimeSeconds: 61.4,
      folders,
    });
    expect(report).toContain("Version: 0.5.2\n");
    expect(report).toContain("Workspaces: 3, panels open: 2, running for 61 s");
    expect(report).toContain("startup: 900, 900, 900, 1x");
    expect(report).toContain("update 0.5.3 available");
    expect(report).toContain("could not read <home>\\x");
    expect(report).not.toContain("Alex");
  });
});