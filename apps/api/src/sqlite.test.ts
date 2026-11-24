import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openStateDb } from "./sqlite.ts";

/** Another process (the maintainer's catalog.mjs, the backup) holds the file's write lock for `ms`. */
async function holdLock(file: string, ms: number): Promise<{ released: Promise<void> }> {
  const script = `const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("begin immediate; insert into t values (1);");
console.log("locked");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
db.exec("commit");`;
  const child = spawn(process.execPath, ["-e", script, file, String(ms)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve) => child.stdout.on("data", (chunk) => String(chunk).includes("locked") && resolve()));
  // In an object: an async function that resolves to a promise would wait for that one too.
  return { released: new Promise<void>((resolve) => child.on("exit", () => resolve())) };
}

describe("openStateDb", () => {
  it("waits for another process's write instead of failing with 'database is locked'", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-sqlite-")), "state.sqlite");
    const setup = new DatabaseSync(file);
    setup.exec("pragma journal_mode = wal; create table t (v integer)");
    setup.close();

    let lock = await holdLock(file, 400);
    const plain = new DatabaseSync(file);
    expect(() => plain.exec("insert into t values (2)")).toThrow(/locked/);
    plain.close();
    await lock.released;

    lock = await holdLock(file, 400);
    const db = openStateDb(file);
    db.exec("insert into t values (3)");
    expect(db.prepare("select count(*) as n from t").get()).toEqual({ n: 3 });
    db.close();
    await lock.released;
  }, 30_000);
});
