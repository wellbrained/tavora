import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isHostSender, officialPublishAllowed } from "./host-sender";

const HOST = 7;
const main = { parent: null };
const sub = { parent: {} };

describe("isHostSender", () => {
  it("lets the host window's main frame through", () => {
    expect(isHostSender({ sender: { id: HOST }, senderFrame: main }, HOST)).toBe(true);
  });

  it("refuses a module's web contents, even from its main frame", () => {
    expect(isHostSender({ sender: { id: 99 }, senderFrame: main }, HOST)).toBe(false);
  });

  it("refuses a sub-frame of the host window", () => {
    expect(isHostSender({ sender: { id: HOST }, senderFrame: sub }, HOST)).toBe(false);
  });

  it("refuses an event with no frame", () => {
    expect(isHostSender({ sender: { id: HOST } }, HOST)).toBe(false);
    expect(isHostSender({ sender: { id: HOST }, senderFrame: null }, HOST)).toBe(false);
  });
});

describe("host.ts registrations", () => {
  const source = readFileSync(path.join(__dirname, "host.ts"), "utf8");

  it("defines the check with isHostSender", () => {
    expect(source).toMatch(/const fromHost = \([^)]*\) =>\s*isHostSender\(event, this\.window\.webContents\.id\)/);
  });

  it("sends every host:* handler through fromHost", () => {
    const starts = [...source.matchAll(/ipcMain\.(?:handle|on)\("host:[a-z-]+"/g)];
    expect(starts.length).toBeGreaterThan(30);
    for (const [i, start] of starts.entries()) {
      const end = starts[i + 1]?.index ?? source.indexOf("\n\n", start.index);
      const body = source.slice(start.index, end);
      expect(body, start[0]).toContain("fromHost(event)");
    }
  });
});

describe("officialPublishAllowed", () => {
  it("refuses a packaged build", () => {
    expect(officialPublishAllowed(true, true)).toBe(false);
  });

  it("allows a dev build with pins, and refuses one without", () => {
    expect(officialPublishAllowed(false, true)).toBe(true);
    expect(officialPublishAllowed(false, false)).toBe(false);
  });
});
