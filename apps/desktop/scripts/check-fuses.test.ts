import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module run by CI's packaged-start job
import { FuseState, fuseProblems, REQUIRED_FUSES } from "./check-fuses.mjs";

const SAFE = {
  version: "1",
  [FuseV1Options.RunAsNode]: FuseState.DISABLE,
  [FuseV1Options.EnableCookieEncryption]: FuseState.ENABLE,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FuseState.DISABLE,
  [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: FuseState.ENABLE,
  [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.ENABLE,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: FuseState.DISABLE,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: FuseState.DISABLE,
};

describe("check-fuses", () => {
  it("passes the safe wire", () => {
    expect(fuseProblems(SAFE)).toEqual([]);
  });

  it("names every fuse that is set the wrong way or missing", () => {
    expect(fuseProblems({ ...SAFE, [FuseV1Options.RunAsNode]: FuseState.ENABLE })).toEqual(["RunAsNode should be disabled, is enabled"]);
    expect(fuseProblems({ ...SAFE, [FuseV1Options.OnlyLoadAppFromAsar]: FuseState.DISABLE })).toEqual(["OnlyLoadAppFromAsar should be enabled, is disabled"]);
    const { [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: _gone, ...missing } = SAFE;
    expect(fuseProblems(missing)).toEqual(["EnableEmbeddedAsarIntegrityValidation should be enabled, is missing"]);
    expect(fuseProblems({ version: "1" })).toHaveLength(6);
  });

  // Electron's own exe, where its install downloaded it (not on macOS, where the wire sits in a framework).
  const electron = path.join(__dirname, "..", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  it.skipIf(process.platform === "darwin" || !existsSync(electron))("reads a real Electron exe, whose fuses are not flipped", async () => {
    const problems: string[] = fuseProblems(await getCurrentFuseWire(electron));
    expect(problems).toContain("RunAsNode should be disabled, is enabled");
    expect(problems).toContain("OnlyLoadAppFromAsar should be enabled, is disabled");
  });

  it("asks for what package.json's electronFuses sets", () => {
    const fuses = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).build.electronFuses as Record<string, boolean>;
    const key = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
    for (const [name, on] of REQUIRED_FUSES as [string, boolean][]) expect(fuses[key(name)], name).toBe(on);
    expect(JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).build.asar).toBe(true);
  });
});
