import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseShortcut, readShortcutIcons, saveShortcutIcon, shortcutFolders } from "./steam-shortcuts";

const HASH = "47fe7aaf058046397e2d99315425634ae7beec6e";
const shortcut = (appid: string, icon: string) => `[{000214A0-0000-0000-C000-000000000046}]
Prop3=19,0
[InternetShortcut]
IDList=
IconIndex=0
URL=steam://rungameid/${appid}
IconFile=${icon}
`;
/** The smallest file that passes for an icon: one 16 px frame. */
const ICO = (() => {
  const bytes = new Uint8Array(6 + 16 + 40);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  bytes[6] = 16;
  bytes[7] = 16;
  view.setUint16(6 + 4, 1, true);
  view.setUint16(6 + 6, 32, true);
  view.setUint32(6 + 8, 40, true);
  view.setUint32(6 + 12, 22, true);
  return bytes;
})();

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-shortcut-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseShortcut", () => {
  it("reads the game and the icon's name from a Steam shortcut, whatever folder it names", () => {
    expect(parseShortcut(shortcut("2807960", `C:/Program Files (x86)/Steam/steam/games/${HASH}.ico`))).toEqual({ appid: 2807960, hash: HASH });
    const windowsPath = [String.raw`C:\Program Files (x86)\Steam\steam\games`, `${HASH}.ico`].join("\\");
    expect(parseShortcut(shortcut("2807960", windowsPath))).toEqual({ appid: 2807960, hash: HASH });
    expect(parseShortcut(shortcut("2807960", `D:/elsewhere/${HASH.toUpperCase()}.ico`))).toEqual({ appid: 2807960, hash: HASH });
  });

  it("gives null for anything that is not a Steam game's shortcut with a hash-named icon", () => {
    expect(parseShortcut(shortcut("2807960", "C:/games/game.ico"))).toBeNull();
    expect(parseShortcut(shortcut("2807960", `C:/x/${HASH}.exe`))).toBeNull();
    expect(parseShortcut(shortcut("abc", `C:/x/${HASH}.ico`))).toBeNull();
    expect(parseShortcut(`[InternetShortcut]\nURL=https://example.com\nIconFile=C:/x/${HASH}.ico\n`)).toBeNull();
    expect(parseShortcut("")).toBeNull();
  });
});

describe("readShortcutIcons", () => {
  it("collects the icons of each game from the shortcut folders, in folder order, and skips what it cannot use", async () => {
    const start = path.join(dir, "start");
    const desktop = path.join(dir, "desktop");
    await mkdir(start);
    await mkdir(desktop);
    await writeFile(path.join(start, "A.url"), shortcut("1", `x/${HASH}.ico`));
    await writeFile(path.join(desktop, "A.url"), shortcut("1", `x/${"a".repeat(40)}.ico`));
    await writeFile(path.join(desktop, "B.url"), shortcut("2", `x/${"b".repeat(40)}.ico`));
    await writeFile(path.join(desktop, "readme.txt"), shortcut("3", `x/${"c".repeat(40)}.ico`));
    await writeFile(path.join(desktop, "huge.url"), "x".repeat(20_000));
    const icons = await readShortcutIcons([start, desktop, path.join(dir, "missing")]);
    expect([...icons]).toEqual([
      [1, [HASH, "a".repeat(40)]],
      [2, ["b".repeat(40)]],
    ]);
  });
});

describe("saveShortcutIcon", () => {
  it("copies the icon out of Steam's games folder, and gives none for a missing or broken file", async () => {
    const steam = path.join(dir, "Steam");
    const icons = path.join(dir, "icons");
    await mkdir(path.join(steam, "steam", "games"), { recursive: true });
    await mkdir(icons);
    await writeFile(path.join(steam, "steam", "games", `${HASH}.ico`), ICO);
    await writeFile(path.join(steam, "steam", "games", `${"d".repeat(40)}.ico`), "not an icon");
    expect(await saveShortcutIcon(icons, steam, 2807960, HASH)).toEqual({ status: "saved", file: "2807960.ico" });
    expect(await saveShortcutIcon(icons, steam, 5, "d".repeat(40))).toEqual({ status: "none" });
    expect(await saveShortcutIcon(icons, steam, 5, "e".repeat(40))).toEqual({ status: "none" });
    expect(await saveShortcutIcon(icons, steam, 5, "../../x")).toEqual({ status: "none" });
  });
});

describe("shortcutFolders", () => {
  it("names the Steam folder in the Start menu and the desktops", () => {
    expect(shortcutFolders({ APPDATA: "A", USERPROFILE: "U", PUBLIC: "P" }).map((folder) => folder.replaceAll(path.sep, "/"))).toEqual([
      "A/Microsoft/Windows/Start Menu/Programs/Steam",
      "U/Desktop",
      "P/Desktop",
    ]);
    expect(shortcutFolders({})).toEqual([]);
  });
});
