// The guard's eyes (file-writes.test-helper.ts): each way a write can be reached, as a source would reach it.
import { describe, expect, it } from "vitest";
import { fileWrites, savedFileKinds } from "./file-writes.test-helper";

/** The writes found in each source given, by path under main/. */
const writesOf = (sources: Record<string, string>) => Object.fromEntries([...fileWrites(new Map(Object.entries(sources)))].filter(([, found]) => found.length));
/** The writes found in one source, `store.ts`, next to fsutil.ts. */
const writesIn = (text: string) => writesOf({ "fsutil.ts": FSUTIL, "store.ts": text })["store.ts"] ?? [];

const FSUTIL = `import { rename, writeFile } from "node:fs/promises";
export async function writeFileAtomic(file: string, body: string) { await writeFile(file + ".tmp", body); await rename(file + ".tmp", file); }`;

describe("file writes", () => {
  it.each([
    ["a renamed import", `import { writeFile as put } from "node:fs/promises";\nexport const a = () => put("library.json", "{}");`, ['writeFile("library.json")']],
    ["a handle that writes", `import { open } from "node:fs/promises";\nexport async function b() { const h = await open("f", "r+"); await h.write("x"); }`, ['open("f")', "FileHandle.write(h)"]],
    ["openSync and writeSync", `import { openSync, writeSync } from "node:fs";\nexport function c() { const fd = openSync("f", "r+"); writeSync(fd, "x"); }`, ['openSync("f")', "writeSync(fd)"]],
    ["an open with a flag it can't read", `import { open } from "node:fs/promises";\nexport const d = (flag: string) => open("f", flag);`, ['open("f")']],
    ["truncate", `import { truncate } from "node:fs/promises";\nexport const e = () => truncate("f");`, ['truncate("f")']],
    ["a renamed createWriteStream", `import { createWriteStream as cws } from "node:fs";\nexport const f = () => cws("f");`, ['createWriteStream("f")']],
    ["new WriteStream", `import { WriteStream } from "node:fs";\nexport const g = () => new WriteStream("f" as never);`, ['new WriteStream("f" as never)']],
    ["new fs.WriteStream", `import * as fs from "node:fs";\nexport const g = () => new fs.WriteStream("f" as never);`, ['new WriteStream("f" as never)']],
    ["a rename onto the user's file, with both paths", `import { rename } from "node:fs/promises";\nexport const h = (dir: string) => rename("x", dir + "/library.json");`, ['rename("x", dir + "/library.json")']],
    ["fs.promises", `import * as fs from "node:fs";\nexport const i = () => fs.promises.writeFile("f", "x");`, ['writeFile("f")']],
    ["promises from fs", `import { promises } from "node:fs";\nexport const j = () => promises.appendFile("f", "x");`, ['appendFile("f")']],
    ["plain destructuring of a default import", `import fs from "node:fs";\nconst { writeFileSync: w } = fs;\nexport const k = () => w("f", "x");`, ['writeFileSync("f")']],
    ["promises destructured", `import fs from "node:fs";\nconst { promises: p } = fs;\nexport const l = () => p.writeFile("f", "x");`, ['writeFile("f")']],
    ["a name given a writer with =", `import { writeFileAtomic } from "./fsutil";\nconst later = writeFileAtomic;\nexport const m = () => later("f", "x");`, ['fsutil.writeFileAtomic("f")']],
  ])("follows %s", (_, text, expected) => {
    expect(writesIn(text)).toEqual(expected);
  });

  it.each([
    ["a writer handed on", `import { writeFile } from "node:fs/promises";\nexport const o = { put: writeFile };`, "ref writeFile"],
    ["a writer taken with ??", `import { writeFile } from "node:fs/promises";\ndeclare const other: typeof writeFile | undefined;\nexport const p = other ?? writeFile;`, "ref writeFile"],
    ["a writer taken with ||=", `import { writeFile } from "node:fs/promises";\nlet q: typeof writeFile | undefined;\nq ||= writeFile;`, "ref writeFile"],
    ["a writer called through a comma", `import { writeFile } from "node:fs/promises";\nexport const r = () => (0, writeFile)("f", "x");`, "ref writeFile"],
    ["a module taken with ||", `import * as fs from "node:fs";\ndeclare const other: typeof fs | undefined;\nexport const s = other || fs;`, "ref node:fs"],
    ["a computed key", `import * as fs from "node:fs";\nexport const t = (k: "writeFileSync") => fs[k]("f", "x");`, "ref node:fs"],
    ["nested destructuring", `import fs from "node:fs";\nconst { promises: { writeFile: w } } = fs;\nexport const u = () => w("f", "x");`, "ref node:fs"],
    ["a rest element", `import fs from "node:fs";\nconst { ...all } = fs;\nexport const v = () => all.writeFileSync("f", "x");`, "ref node:fs"],
    ["require", `export const w = () => require("node:fs").writeFileSync("f", "x");`, "require node:fs"],
    ["import()", `export const x = async () => (await import("node:fs/promises")).writeFile("f", "x");`, "require node:fs/promises"],
    ["createRequire", `import { createRequire } from "node:module";\nexport const y = createRequire(__filename);`, "refused createRequire"],
    ["original-fs", `import * as fs from "original-fs";\nexport const z = () => fs.writeFileSync("f", "x");`, "refused original-fs"],
    ["a writer exported under a name of its own", `import { writeFileSync } from "node:fs";\nexport const put = writeFileSync;`, "export put = writeFileSync"],
    ["a module exported under a name of its own", `import * as fs from "node:fs";\nexport const files = fs;`, "export files = node:fs"],
    ["a writer exported again", `export { writeFileSync as put } from "node:fs";`, "export writeFileSync"],
    ["a module exported again whole", `export * from "node:fs";`, "export * from node:fs"],
    ["one of main/'s writers exported again", `export { writeFileAtomic } from "./fsutil";`, "export fsutil.writeFileAtomic"],
  ])("finds %s", (_, text, expected) => {
    expect(writesIn(text)).toContain(expected);
  });

  it("follows a source in a folder of main/, and its imports from main/", () => {
    expect(writesOf({ "fsutil.ts": FSUTIL, "sub/store.ts": `import { writeFileAtomic } from "../fsutil";\nexport const n = () => writeFileAtomic("f", "x");` })["sub/store.ts"]).toEqual(['fsutil.writeFileAtomic("f")']);
  });

  it("follows a writer wrapped in another module, and one wrapping that, however deep", () => {
    const found = writesOf({
      "fsutil.ts": FSUTIL,
      "a.ts": `import { writeFileAtomic } from "./fsutil";\nfunction body(x: unknown) { return JSON.stringify(x); }\nexport async function saveThing(file: string, x: unknown) { await writeFileAtomic(file, body(x)); }`,
      "b.ts": `import { saveThing } from "./a";\nconst helper = (file: string) => saveThing(file, 1);\nexport function saveMore(file: string) { return helper(file); }`,
      "sub/c.ts": `import { saveMore as keep } from "../b";\nexport const c = (dir: string) => keep(dir + "/library.json");`,
      "d.ts": `import * as b from "./b";\nexport const d = () => b.saveMore("library.json");`,
    });
    expect(found["a.ts"]).toEqual(["fsutil.writeFileAtomic(file)"]);
    expect(found["b.ts"]).toEqual(["a.saveThing(file)"]);
    expect(found["sub/c.ts"]).toEqual(['b.saveMore(dir + "/library.json")']);
    expect(found["d.ts"]).toEqual(['b.saveMore("library.json")']);
  });

  it("leaves reads, and names that only look like the file system's, alone", () => {
    const text = `import { open, readFile } from "node:fs/promises";
interface Deps { open(): Promise<void>; write(x: string): void }
export async function read(deps: Deps, file: string) {
  const handle = await open(file, "r");
  await handle.read();
  await deps.open();
  deps.write("x");
  return readFile(file, "utf8");
}
export type Handle = Awaited<ReturnType<typeof open>>;`;
    expect(writesIn(text)).toEqual([]);
  });
});

describe("SavedFile's kinds", () => {
  it("finds an inline kind, a SavedFile extended, and one handed on", () => {
    expect(savedFileKinds("store.ts", `import { SavedFile } from "./saved-file";\nexport const m = new SavedFile("f", { version: 2, format: "lines" });`).kinds).toEqual(['{ version: 2, format: "lines" }']);
    expect(savedFileKinds("sub/store.ts", `import { SavedFile as File } from "../saved-file";\nexport class Mine extends File {}`).extended).toBe(true);
    expect(savedFileKinds("store.ts", `import { SavedFile } from "./saved-file";\nexport const Made = SavedFile;`).kinds).toEqual(["ref SavedFile"]);
  });
});
