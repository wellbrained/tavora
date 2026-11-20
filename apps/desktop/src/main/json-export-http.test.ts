import { describe, it, expect } from "vitest";
import { serveJsonExport } from "./json-export-http";
import { MAX_JSON_EXPORT_BYTES, type JsonSaveDeps } from "./json-file-http";
import { cleanPictureName } from "./picture-save-http";

const url = new URL("tavora-module://local.enshrouded/_exports/json/?name=..%2F..%2Fbuild.exe");

/** A press that allows one call, and a save dialog that answers `answer` (null: the user closed it). */
function deps(answer: (name: string) => string | null = (name) => `${name}.json`) {
  let available = true;
  const saved: { data: Buffer; name: string }[] = [];
  return {
    saved,
    value: {
      allowed: () => available,
      consume: () => {
        available = false;
      },
      save: async (data, name) => {
        saved.push({ data, name });
        return answer(name);
      },
    } satisfies JsonSaveDeps,
  };
}
const post = (body: BodyInit, address = url) => new Request(address, { method: "POST", body });

describe("files.exportJson", () => {
  it("saves through the save dialog after one press, with a safe name filled in", async () => {
    const { value, saved } = deps();
    const reply = await serveJsonExport(post('{"skills":["2"]}'), url, value, cleanPictureName);
    expect(reply.status).toBe(200);
    expect((await reply.json()).fileName).not.toMatch(/[\\/]/);
    expect(saved[0]!.name).not.toMatch(/[\\/]/);
    expect(saved[0]!.data.toString()).toBe('{\n  "skills": [\n    "2"\n  ]\n}\n');
    // One press saves one file.
    expect((await serveJsonExport(post("{}"), url, value, cleanPictureName)).status).toBe(403);
    expect(saved).toHaveLength(1);
  });

  it("suggests Build when the module names nothing", async () => {
    const { value, saved } = deps();
    const address = new URL("tavora-module://local.enshrouded/_exports/json/");
    expect((await serveJsonExport(post("{}", address), address, value, cleanPictureName)).status).toBe(200);
    expect(saved[0]!.name).toBe("Build");
  });

  it("refuses with PERMISSION_DENIED when the user closes the dialog, as the SDK promises a file name", async () => {
    const { value } = deps(() => null);
    const reply = await serveJsonExport(post("{}"), url, value, cleanPictureName);
    expect(reply.status).toBe(403);
    expect((await reply.json()).error.code).toBe("PERMISSION_DENIED");
  });

  it("opens no dialog without a press", async () => {
    const { value, saved } = deps();
    const refused = { ...value, allowed: () => false };
    expect((await serveJsonExport(post("{}"), url, refused, cleanPictureName)).status).toBe(403);
    expect(saved).toHaveLength(0);
  });

  it("saves a guide build bigger than the old 1 MiB limit", async () => {
    const { value, saved } = deps();
    const build = { guideExport: "x".repeat(3 * 1024 * 1024) };
    expect((await serveJsonExport(post(JSON.stringify(build)), url, value, cleanPictureName)).status).toBe(200);
    expect(JSON.parse(saved[0]!.data.toString())).toEqual(build);
  });

  it("rejects invalid UTF-8, malformed or oversized JSON and non-POST methods", async () => {
    for (const data of ["not JSON", new Uint8Array([255, 254]), " ".repeat(MAX_JSON_EXPORT_BYTES + 1)]) {
      const d = deps();
      expect((await serveJsonExport(post(data), url, d.value, cleanPictureName)).status).toBeGreaterThanOrEqual(400);
      expect(d.saved).toHaveLength(0);
    }
    expect((await serveJsonExport(new Request(url), url, deps().value, cleanPictureName)).status).toBe(405);
  });
});
