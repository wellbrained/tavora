import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain JavaScript module shared with scripts/release.mjs
import { installedVersion } from "./installed-version.mjs";

async function install(version: string, dir = mkdtempSync(path.join(tmpdir(), "installed-version-"))): Promise<string> {
  const app = mkdtempSync(path.join(tmpdir(), "installed-app-"));
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "Tavora", version }));
  mkdirSync(path.join(dir, "resources"), { recursive: true });
  await asar.createPackage(app, path.join(dir, "resources", "app.asar"));
  return dir;
}

describe("installedVersion", () => {
  it("reads the version from the package.json in app.asar, fresh after an update", async () => {
    const dir = await install("0.24.80");
    expect(installedVersion(dir)).toBe("0.24.80");
    await install("0.24.81", dir);
    expect(installedVersion(dir)).toBe("0.24.81");
  });

  it("reads an older install, whose app is unpacked", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "installed-old-"));
    mkdirSync(path.join(dir, "resources", "app"), { recursive: true });
    writeFileSync(path.join(dir, "resources", "app", "package.json"), JSON.stringify({ version: "0.24.79" }));
    expect(installedVersion(dir)).toBe("0.24.79");
  });

  it("is null without an installed Tavora", () => {
    expect(installedVersion(mkdtempSync(path.join(tmpdir(), "installed-none-")))).toBeNull();
  });
});
