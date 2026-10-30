import { describe, expect, it } from "vitest";
import { HOST_FEATURES, METHOD_INFO, MIN_TAVORA, needsGesture, supportsCall, versionAtLeast, type CallName } from "./protocol.js";
import { createMemoryHost } from "./testing.js";
import { MIN_TAVORA as exported } from "./index.js";

const names = Object.keys(METHOD_INFO) as CallName[];

describe("METHOD_INFO", () => {
  it("gives every call a dotted Tavora version, and MIN_TAVORA is the SDK's", () => {
    for (const method of names) expect(METHOD_INFO[method].since, method).toMatch(/^\d+\.\d+\.\d+$/);
    expect(exported).toBe(MIN_TAVORA);
  });

  it("derives MIN_TAVORA from the calls not marked later and the host features", () => {
    const wanted = [...names.filter((name) => !METHOD_INFO[name].later).map((name) => METHOD_INFO[name].since), ...Object.values(HOST_FEATURES)];
    expect(wanted.every((version) => versionAtLeast(MIN_TAVORA, version))).toBe(true);
    expect(wanted).toContain(MIN_TAVORA);
  });

  it("marks exactly the calls newer than MIN_TAVORA as later", () => {
    for (const method of names) expect(Boolean(METHOD_INFO[method].later), method).toBe(!versionAtLeast(MIN_TAVORA, METHOD_INFO[method].since));
  });

  it("needs a click for the calls the host checks, with the params that make it so", () => {
    expect(needsGesture("links.open")).toBe(true);
    expect(needsGesture("storage.get")).toBe(false);
    expect(needsGesture("panel.setDialog", { open: true })).toBe(true);
    expect(needsGesture("panel.setDialog", { open: false })).toBe(false);
    expect(needsGesture("discord.command", { command: "SET_VOICE_SETTINGS" })).toBe(true);
    expect(needsGesture("discord.command", { command: "GET_CHANNEL" })).toBe(false);
    expect(needsGesture("ui.tooltip.show", { pinned: true })).toBe(true);
    expect(needsGesture("ui.tooltip.show", {})).toBe(false);
  });
});

describe("supports", () => {
  it("compares the host version with the table, by SDK name too", () => {
    expect(supportsCall("0.21.91", "storage.compareAndSet")).toBe(false);
    expect(supportsCall("0.21.92", "storage.compareAndSet")).toBe(true);
    expect(supportsCall("0.21.94", "panel.openDialog")).toBe(false);
    expect(supportsCall("0.21.95", "panel.openDialog")).toBe(true);
  });

  it("is on the sdk, and agrees with what the memory host throws", async () => {
    const old = createMemoryHost({ version: "0.21.50" }).sdk;
    const latest = createMemoryHost().sdk;
    expect(old.supports("storage.compareAndSet")).toBe(false);
    expect(old.supports("storage.get")).toBe(true);
    expect(latest.supports("panel.openDialog")).toBe(true);
    await expect(old.storage.compareAndSet("k", null, 1)).rejects.toMatchObject({ code: "UNKNOWN_METHOD" });
  });
});
