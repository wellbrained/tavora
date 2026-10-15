import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { iconDataUrl, MAX_MODULE_ICON, moduleIconUrl } from "./module-icon";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);

describe("iconDataUrl", () => {
  it("accepts a small PNG or WebP by its signature", () => {
    expect(iconDataUrl(PNG)).toMatch(/^data:image\/png;base64,/);
    expect(iconDataUrl(WEBP)).toMatch(/^data:image\/webp;base64,/);
  });

  it("refuses anything else, including an SVG named like an image, and anything too large", () => {
    expect(iconDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(iconDataUrl(Buffer.from("tiny"))).toBeNull();
    expect(iconDataUrl(Buffer.concat([PNG, Buffer.alloc(MAX_MODULE_ICON)]))).toBeNull();
  });
});

describe("moduleIconUrl", () => {
  it("reads the manifest's icon from inside the package only", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-icon-")));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "icon.png"), PNG);
    await writeFile(path.join(root, "assets", "fake.png"), "not a picture");
    expect(await moduleIconUrl(root, "assets/icon.png")).toMatch(/^data:image\/png;base64,/);
    expect(await moduleIconUrl(root, "assets/fake.png")).toBeNull();
    expect(await moduleIconUrl(root, "assets/missing.png")).toBeNull();
    expect(await moduleIconUrl(root, "../outside.png")).toBeNull();
    expect(await moduleIconUrl(root, undefined)).toBeNull();
  });

  it("does not follow a link out of the package", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-icon-")));
    const outside = await mkdtemp(path.join(tmpdir(), "tavora-outside-"));
    await writeFile(path.join(outside, "secret.png"), PNG);
    try {
      await symlink(path.join(outside, "secret.png"), path.join(root, "icon.png"));
    } catch {
      return; // symlinks need rights on some systems
    }
    expect(await moduleIconUrl(root, "icon.png")).toBeNull();
  });
});
