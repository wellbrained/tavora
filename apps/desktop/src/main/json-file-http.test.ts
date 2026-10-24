import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_JSON_EXPORT_BYTES } from "./json-export-http";
import { formatJson, readJsonText, serveJsonOpen, serveJsonSave, type JsonOpenDeps, type JsonSaveDeps } from "./json-file-http";
import { cleanPictureName, freeFileName } from "./picture-save-http";

describe("freeFileName for JSON", () => {
  it("numbers a taken name and keeps the extension", () => {
    const taken = new Set(["Build.json", "Build (2).json"]);
    expect(freeFileName("Build", (name) => taken.has(name), "json")).toBe("Build (3).json");
    expect(freeFileName("New", (name) => taken.has(name), "json")).toBe("New.json");
  });
});

describe("formatJson", () => {
  it("writes the pretty form exportJson writes", () => {
    expect(formatJson({ a: [1] }).toString()).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });
});

describe("serveJsonSave", () => {
  function deps(allowed = true, closed = false) {
    const state = { allowed, saved: [] as { data: string; name: string }[] };
    const value: JsonSaveDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false),
      save: async (data, name) => {
        if (closed) return null;
        state.saved.push({ data: data.toString(), name });
        return `${name}.json`;
      },
    };
    return { state, value };
  }
  const post = (body: string | null, name = "Build 1") => {
    const url = new URL(`tavora-module://notes/_files/json/save/?name=${encodeURIComponent(name)}`);
    return { request: new Request(url, { method: "POST", body }), url };
  };
  const save = (p: ReturnType<typeof post>, d: JsonSaveDeps) => serveJsonSave(p.request, p.url, d, cleanPictureName);

  it("saves formatted JSON after a click under a cleaned name, once per click", async () => {
    const { state, value } = deps();
    const response = await save(post('{"a":1}', "Build/1"), value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: "Build 1.json" });
    expect(state.saved).toEqual([{ data: '{\n  "a": 1\n}\n', name: "Build 1" }]);
    expect((await save(post("{}"), value)).status).toBe(403);
  });

  it("answers null when the player closed the save dialog", async () => {
    const response = await save(post("[]"), deps(true, true).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: null });
  });

  it("refuses without a click, without a body, anything but JSON, and a GET", async () => {
    expect((await save(post("{}"), deps(false).value)).status).toBe(403);
    const { state, value } = deps();
    expect((await save(post("not json {"), value)).status).toBe(415);
    expect(state.saved).toHaveLength(0);
    const get = new URL("tavora-module://notes/_files/json/save/");
    expect((await serveJsonSave(new Request(get), get, value, cleanPictureName)).status).toBe(405);
  });

  it("refuses more than 8 MiB", async () => {
    const { state, value } = deps();
    const big = JSON.stringify("x".repeat(MAX_JSON_EXPORT_BYTES));
    expect((await save(post(big), value)).status).toBe(413);
    expect(state.saved).toHaveLength(0);
  });
});

describe("serveJsonOpen", () => {
  function deps(picked: { fileName: string; text: string } | null, allowed = true) {
    const state = { allowed, opened: 0 };
    const value: JsonOpenDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false),
      open: async () => {
        state.opened++;
        return picked;
      },
    };
    return { state, value };
  }
  const post = () => new Request("tavora-module://notes/_files/json/open/", { method: "POST" });

  it("answers the file name and the parsed value, once per click", async () => {
    const { value } = deps({ fileName: "Build.json", text: '{"a":[1,2]}' });
    const response = await serveJsonOpen(post(), value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: "Build.json", value: { a: [1, 2] } });
    expect((await serveJsonOpen(post(), value)).status).toBe(403);
  });

  it("answers null when the player closed the dialog", async () => {
    const response = await serveJsonOpen(post(), deps(null).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("says clearly when the file is not JSON", async () => {
    const response = await serveJsonOpen(post(), deps({ fileName: "notes.json", text: "hello" }).value);
    expect(response.status).toBe(415);
    expect(JSON.stringify(await response.json())).toContain("notes.json is not valid JSON");
  });

  it("refuses without a click, and a GET; the dialog is not even shown", async () => {
    const { state, value } = deps({ fileName: "a.json", text: "{}" }, false);
    expect((await serveJsonOpen(post(), value)).status).toBe(403);
    expect(state.opened).toBe(0);
    expect((await serveJsonOpen(new Request("tavora-module://notes/_files/json/open/"), value)).status).toBe(405);
  });
});

describe("readJsonText", () => {
  it("reads a small file, and refuses one over 8 MiB, a folder, or a file that is not text", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-json-"));
    try {
      const small = path.join(dir, "a.json");
      await writeFile(small, '{"a":1}');
      expect(await readJsonText(small)).toBe('{"a":1}');
      const big = path.join(dir, "big.json");
      await writeFile(big, Buffer.alloc(MAX_JSON_EXPORT_BYTES + 1, 32));
      await expect(readJsonText(big)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      const binary = path.join(dir, "bin.json");
      await writeFile(binary, Buffer.from([0xff, 0xfe, 0x00]));
      await expect(readJsonText(binary)).rejects.toMatchObject({ code: "INVALID_PARAMS" });
      await expect(readJsonText(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
