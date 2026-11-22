import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { quitOnUnsafeSwitches } from "./unsafe-start";

function run(packaged: boolean, argv: string[]) {
  const show = vi.fn();
  const quit = vi.fn();
  const quitted = quitOnUnsafeSwitches({ packaged, argv, show, quit });
  return { quitted, show, quit };
}

describe("quitOnUnsafeSwitches", () => {
  it("quits a packaged Tavora started with an unsafe switch, and says why", () => {
    const { quitted, show, quit } = run(true, ["--remote-debugging-port=9222"]);
    expect(quitted).toBe(true);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(expect.stringContaining("--remote-debugging-port"));
  });

  it("quits on any switch it doesn't take, a bare -- too", () => {
    for (const argv of [["--enable-logging=file"], ["--updated", "--"]]) {
      const { quitted, quit } = run(true, argv);
      expect(quitted, argv.join(" ")).toBe(true);
      expect(quit).toHaveBeenCalledTimes(1);
    }
  });

  it("goes on for a packaged Tavora with clean arguments", () => {
    const { quitted, show, quit } = run(true, ["--updated", "--disable-gpu"]);
    expect(quitted).toBe(false);
    expect(quit).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("goes on for an unpackaged run, switch or not", () => {
    const { quitted, quit } = run(false, ["--host-resolver-rules=MAP * 127.0.0.1"]);
    expect(quitted).toBe(false);
    expect(quit).not.toHaveBeenCalled();
  });

  it("is wired into index.ts with the real argv and process.exit", () => {
    const source = readFileSync(path.join(__dirname, "index.ts"), "utf8");
    expect(source).toContain("quitOnUnsafeSwitches({");
    expect(source).toContain("packaged: app.isPackaged");
    expect(source).toContain("argv: process.argv.slice(1)");
    expect(source).toContain("quit: () => process.exit(1)");
  });
});
