import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  serveJsonExport,
  saveJsonExport,
  MAX_JSON_EXPORT_BYTES,
  type JsonExportDeps,
} from "./json-export-http";
const url = new URL(
  "tavora-module://local.enshrouded/_exports/json/?name=..%2F..%2Fbuild.exe",
);
function deps() {
  let available = true;
  const saved: Buffer[] = [];
  return {
    saved,
    value: {
      allowed: () => available,
      consume: () => {
        available = false;
      },
      save: async (data, name) => {
        saved.push(data);
        return name + ".json";
      },
    } satisfies JsonExportDeps,
  };
}
const post = (body: BodyInit) => new Request(url, { method: "POST", body });
describe("bounded JSON export", () => {
  it("consumes a trusted gesture once, sanitizes paths and formats only JSON", async () => {
    const { value, saved } = deps();
    const reply = await serveJsonExport(post('{"skills":["2"]}'), url, value);
    expect(reply.status).toBe(200);
    expect((await reply.json()).fileName).not.toMatch(/[\\/]/);
    expect(JSON.parse(saved[0]!.toString())).toEqual({ skills: ["2"] });
    expect((await serveJsonExport(post("{}"), url, value)).status).toBe(403);
  });
  it("saves a guide build bigger than the old 1 MiB limit", async () => {
    const { value, saved } = deps();
    const build = { guideExport: "x".repeat(3 * 1024 * 1024) };
    const reply = await serveJsonExport(post(JSON.stringify(build)), url, value);
    expect(reply.status).toBe(200);
    expect(JSON.parse(saved[0]!.toString())).toEqual(build);
  });
  it("rejects invalid UTF-8, malformed or oversized JSON and non-POST methods", async () => {
    for (const data of [
      "not JSON",
      new Uint8Array([255, 254]),
      " ".repeat(MAX_JSON_EXPORT_BYTES + 1),
    ]) {
      const d = deps();
      expect(
        (await serveJsonExport(post(data), url, d.value)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(d.saved).toHaveLength(0);
    }
    expect(
      (await serveJsonExport(new Request(url), url, deps().value)).status,
    ).toBe(405);
  });
  it("writes inside the fixed folder and preserves existing files, even with concurrent names", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "tavora-json-"));
    const names = await Promise.all([
      saveJsonExport(folder, Buffer.from("1"), "Build"),
      saveJsonExport(folder, Buffer.from("2"), "Build"),
    ]);
    expect(new Set(names).size).toBe(2);
    expect(await readdir(folder)).toHaveLength(2);
    expect(
      (
        await Promise.all(
          names.map((name) => readFile(path.join(folder, name), "utf8")),
        )
      ).sort(),
    ).toEqual(["1", "2"]);
    const name = await saveJsonExport(
      folder,
      Buffer.from("{}"),
      "../../CON.exe",
    );
    expect(name).not.toMatch(/[\\/]/);
  });
});
