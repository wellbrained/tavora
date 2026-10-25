import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_README_BYTES, MAX_SCREENSHOT_BYTES } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { readModulePage, readModuleReadme, readModuleScreenshots } from "./module-page";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

const folder = async () => realpath(await mkdtemp(path.join(tmpdir(), "tavora-page-")));

describe("readModuleReadme", () => {
  it("reads README.md as plain text blocks", async () => {
    const root = await folder();
    await writeFile(path.join(root, "README.md"), "# Tracker\n\nTracks **runs** [here](https://example.com).\n\n<script>alert(1)</script>\n");
    expect(await readModuleReadme(root, undefined)).toEqual([
      { kind: "heading", level: 1, text: "Tracker" },
      { kind: "paragraph", spans: [{ text: "Tracks " }, { text: "runs", bold: true }, { text: " " }, { text: "here", url: "https://example.com" }, { text: "." }] },
      { kind: "paragraph", spans: [{ text: "<script>alert(1)</script>" }] },
    ]);
  });

  it("reads the file the manifest names", async () => {
    const root = await folder();
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "intro.txt"), "Hello there.");
    expect(await readModuleReadme(root, "docs/intro.txt")).toEqual([{ kind: "paragraph", spans: [{ text: "Hello there." }] }]);
  });

  it("gives nothing for a missing, empty or unreachable readme", async () => {
    const root = await folder();
    expect(await readModuleReadme(root, undefined)).toEqual([]);
    await writeFile(path.join(root, "README.md"), "");
    expect(await readModuleReadme(root, undefined)).toEqual([]);
    expect(await readModuleReadme(root, "../README.md")).toEqual([]);
    expect(await readModuleReadme("", undefined)).toEqual([]);
  });

  it("does not follow a link out of the folder", async () => {
    const root = await folder();
    const outside = await mkdtemp(path.join(tmpdir(), "tavora-outside-"));
    await writeFile(path.join(outside, "secret.md"), "Secret");
    try {
      await symlink(path.join(outside, "secret.md"), path.join(root, "README.md"));
    } catch {
      return; // symlinks need rights on some systems
    }
    expect(await readModuleReadme(root, undefined)).toEqual([]);
  });

  it("reads only the first part of a big readme", async () => {
    const root = await folder();
    await writeFile(path.join(root, "README.md"), `${"a".repeat(MAX_README_BYTES - 10)}\n\nTAIL-AFTER-THE-CAP\n${"b".repeat(MAX_README_BYTES)}`);
    const text = JSON.stringify(await readModuleReadme(root, undefined));
    expect(text).not.toContain("TAIL-AFTER-THE-CAP");
    expect(text.length).toBeLessThan(MAX_README_BYTES * 2);
  });
});

describe("readModuleScreenshots", () => {
  it("keeps small PNG or WebP files from inside the folder, in order", async () => {
    const root = await folder();
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "one.png"), PNG);
    await writeFile(path.join(root, "assets", "fake.png"), "not a picture");
    await writeFile(path.join(root, "assets", "big.png"), Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]));
    const shots = await readModuleScreenshots(root, ["assets/fake.png", "assets/one.png", "assets/big.png", "assets/missing.png", "../one.png"]);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("gives nothing without screenshots", async () => {
    expect(await readModuleScreenshots(await folder(), undefined)).toEqual([]);
  });
});

describe("readModulePage", () => {
  it("puts both together", async () => {
    const root = await folder();
    await writeFile(path.join(root, "README.md"), "Hi.");
    await writeFile(path.join(root, "a.png"), PNG);
    const page = await readModulePage(root, { screenshots: ["a.png"] });
    expect(page.readme).toEqual([{ kind: "paragraph", spans: [{ text: "Hi." }] }]);
    expect(page.screenshots).toHaveLength(1);
  });
});
