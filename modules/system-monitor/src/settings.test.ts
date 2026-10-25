import type { SystemInfo } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { createHistory } from "./history";
import { buildMenu, parsePick } from "./menu";
import { cleanTarget, defaultApp, defaultDrives, defaultPanel, parseApp, parsePanel, pickGpu, toggleBlock, toggleSection, watchedDrives, watchRequest } from "./settings";

const info = (overrides: Partial<SystemInfo> = {}): SystemInfo => ({
  cpu: { model: "CPU", threads: 8 },
  ramBytes: 16 * 1024 ** 3,
  gpus: [
    { id: "igpu", name: "Integrated", dedicated: false, vramBytes: null },
    { id: "dgpu", name: "Dedicated", dedicated: true, vramBytes: 8 * 1024 ** 3 },
  ],
  drives: [
    { id: "C:", label: "System", kind: "internal", totalBytes: 1e12 },
    { id: "D:", label: "Games", kind: "internal", totalBytes: 1e12 },
    { id: "E:", label: "Stick", kind: "removable", totalBytes: 1e10 },
    { id: "Z:", label: "", kind: "network", totalBytes: null },
  ],
  ...overrides,
});

const say = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);

describe("drives", () => {
  it("ticks the internal drives until the player chooses", () => {
    expect(defaultDrives(info())).toEqual(["C:", "D:"]);
    expect(watchedDrives(info(), defaultApp())).toEqual(["C:", "D:"]);
  });
  it("keeps an explicit choice, even for a drive that is unplugged, and adds no new ones", () => {
    const app = parseApp({ drives: ["E:", "F:"] });
    expect(watchedDrives(info(), app)).toEqual(["E:", "F:"]);
    expect(watchedDrives(info({ drives: [...info().drives, { id: "G:", label: "", kind: "internal", totalBytes: 1 }] }), app)).toEqual(["E:", "F:"]);
  });
  it("keeps an empty choice empty", () => {
    expect(watchedDrives(info(), parseApp({ drives: [] }))).toEqual([]);
  });
});

describe("parse", () => {
  it("falls back to the defaults for anything odd", () => {
    expect(parseApp(null)).toEqual(defaultApp());
    expect(parseApp({ intervalMs: 3000, drives: "C:" })).toEqual(defaultApp());
    expect(parsePanel("x")).toEqual(defaultPanel());
  });
  it("reads good values and drops bad drive ids", () => {
    expect(parseApp({ intervalMs: 5000, drives: ["c:", "C:", "nope", 4] })).toEqual({ intervalMs: 5000, drives: ["C:"] });
    expect(parsePanel({ blocks: { cpu: false, gpu: true, ram: true, drives: false }, gpu: "igpu" })).toEqual({
      sections: { system: true, connection: true },
      blocks: { cpu: false, gpu: true, ram: true, drives: false },
      gpu: "igpu",
    });
  });
  it("never saves a panel with no block", () => {
    expect(parsePanel({ blocks: { cpu: false, gpu: false, ram: false, drives: false } }).blocks).toEqual(defaultPanel().blocks);
  });
});

describe("blocks", () => {
  it("turns blocks on and off but keeps one", () => {
    let panel = toggleBlock(defaultPanel(), "cpu");
    expect(panel.blocks.cpu).toBe(false);
    panel = toggleBlock(toggleBlock(toggleBlock(panel, "gpu"), "ram"), "drives");
    expect(panel.blocks).toEqual({ cpu: false, gpu: false, ram: false, drives: true });
  });
});

describe("sections", () => {
  it("hides either section but never both", () => {
    let panel = toggleSection(defaultPanel(), "connection");
    expect(panel.sections).toEqual({ system: true, connection: false });
    expect(toggleSection(panel, "system")).toBe(panel);
    panel = toggleSection(toggleSection(panel, "connection"), "system");
    expect(panel.sections).toEqual({ system: false, connection: true });
  });
  it("reads saved sections, and shows both for a panel saved before there were two", () => {
    expect(parsePanel({ blocks: { cpu: true } }).sections).toEqual({ system: true, connection: true });
    expect(parsePanel({ sections: { system: false, connection: true } }).sections).toEqual({ system: false, connection: true });
    expect(parsePanel({ sections: { system: false, connection: false } }).sections).toEqual({ system: true, connection: true });
  });
});

describe("cleanTarget", () => {
  it("takes an IPv4 address or a name, as Tavora does", () => {
    expect(cleanTarget(" 1.1.1.1 ")).toBe("1.1.1.1");
    expect(cleanTarget("Example.com")).toBe("example.com");
    for (const bad of ["", "300.1.1.1", "1.1.1", "0.0.0.0", "224.0.0.1", "http://x.com", "x.com/a", "a b", "-a.com", "router"]) expect(cleanTarget(bad), bad).toBeNull();
  });
});

describe("pickGpu", () => {
  it("takes the choice, else the dedicated card, else the first", () => {
    expect(pickGpu(info(), "igpu")).toBe("igpu");
    expect(pickGpu(info(), null)).toBe("dgpu");
    expect(pickGpu(info(), "gone")).toBe("dgpu");
    expect(pickGpu(info({ gpus: [{ id: "a", name: "A", dedicated: false, vramBytes: null }] }), null)).toBe("a");
    expect(pickGpu(info({ gpus: [] }), null)).toBeNull();
  });
});

describe("watchRequest", () => {
  it("asks only for what the panel shows, plus Tavora's own use", () => {
    expect(watchRequest(info(), defaultApp(), defaultPanel())).toEqual({
      blocks: { tavora: true, connection: true, cpu: true, gpu: true, ram: true, drives: ["C:", "D:"] },
      intervalMs: 1000,
    });
    const panel = parsePanel({ sections: { system: true, connection: false }, blocks: { cpu: true, gpu: false, ram: false, drives: false } });
    expect(watchRequest(info(), { intervalMs: 15000, drives: null }, panel)).toEqual({ blocks: { tavora: true, cpu: true }, intervalMs: 15000 });
  });
  it("asks for the connection alone when the System section is hidden", () => {
    const panel = parsePanel({ sections: { system: false, connection: true } });
    expect(watchRequest(info(), defaultApp(), panel).blocks).toEqual({ tavora: true, connection: true });
  });
  it("leaves out graphics and drives when there are none", () => {
    expect(watchRequest(info({ gpus: [], drives: [] }), defaultApp(), defaultPanel()).blocks).toEqual({ tavora: true, connection: true, cpu: true, ram: true });
  });
});

describe("menu", () => {
  it("checks what is on, and offers the graphics card only with several", () => {
    const entries = buildMenu(say, info(), defaultApp(), defaultPanel());
    const ids = entries.flatMap((entry) => (entry.type === "item" ? [entry.id] : []));
    expect(ids).toEqual(["section:system", "section:connection", "block:cpu", "block:gpu", "block:ram", "block:drives", "interval:1000", "interval:2000", "interval:5000", "interval:15000", "interval:60000", "gpu:igpu", "gpu:dgpu", "drives"]);
    const checked = entries.filter((entry) => entry.type === "item" && entry.checked).map((entry) => (entry.type === "item" ? entry.id : ""));
    expect(checked).toEqual(["section:system", "section:connection", "block:cpu", "block:gpu", "block:ram", "block:drives", "interval:1000", "gpu:dgpu"]);
    expect(buildMenu(say, info({ gpus: [] }), defaultApp(), defaultPanel()).some((entry) => entry.type === "item" && entry.id.startsWith("gpu:"))).toBe(false);
  });
  it("offers the connection dialog once Tavora has settings, with the address or 'off' as hint", () => {
    const settings = { enabled: true, target: "1.1.1.1" };
    const item = (entries: ReturnType<typeof buildMenu>) => entries.find((entry) => entry.type === "item" && entry.id === "connection");
    expect(item(buildMenu(say, info(), defaultApp(), defaultPanel(), settings))).toMatchObject({ hint: "1.1.1.1" });
    expect(item(buildMenu(say, info(), defaultApp(), defaultPanel(), { enabled: false, target: "x.com" }))).toMatchObject({ hint: "menu.connectionOff" });
    expect(item(buildMenu(say, info(), defaultApp(), defaultPanel()))).toBeUndefined();
  });
  it("leaves out the System choices when that section is hidden, and keeps the last section", () => {
    const panel = parsePanel({ sections: { system: false, connection: true } });
    const entries = buildMenu(say, info(), defaultApp(), panel);
    const ids = entries.flatMap((entry) => (entry.type === "item" ? [entry.id] : []));
    expect(ids).toEqual(["section:system", "section:connection", "interval:1000", "interval:2000", "interval:5000", "interval:15000", "interval:60000"]);
    expect(entries.find((entry) => entry.type === "item" && entry.id === "section:connection")).toMatchObject({ disabled: true });
  });
  it("won't turn off the last block", () => {
    const panel = parsePanel({ blocks: { cpu: true, gpu: false, ram: false, drives: false } });
    const cpu = buildMenu(say, info(), defaultApp(), panel).find((entry) => entry.type === "item" && entry.id === "block:cpu");
    expect(cpu).toMatchObject({ disabled: true });
  });
  it("reads a pick", () => {
    expect(parsePick("block:ram")).toEqual({ kind: "block", id: "ram" });
    expect(parsePick("interval:5000")).toEqual({ kind: "interval", ms: 5000 });
    expect(parsePick("gpu:0x00000000_0x0001defc")).toEqual({ kind: "gpu", id: "0x00000000_0x0001defc" });
    expect(parsePick("drives")).toEqual({ kind: "drives" });
    expect(parsePick("section:connection")).toEqual({ kind: "section", id: "connection" });
    expect(parsePick("connection")).toEqual({ kind: "connection" });
    expect(parsePick("section:nope")).toBeNull();
    expect(parsePick("interval:3000")).toBeNull();
    expect(parsePick("block:nope")).toBeNull();
  });
});

describe("history", () => {
  it("keeps the last 5 minutes at the interval and starts over when it changes", () => {
    const history = createHistory(60000);
    for (let i = 0; i < 12; i++) history.push(i);
    expect(history.values()).toEqual([7, 8, 9, 10, 11]);
    history.setInterval(60000);
    expect(history.values()).toHaveLength(5);
    history.setInterval(15000);
    expect(history.values()).toEqual([]);
  });
});
