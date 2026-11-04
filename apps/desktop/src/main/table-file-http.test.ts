import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_FILE_BYTES, type FileKind } from "@tavora/sdk/protocol";
import { describe, expect, it } from "vitest";
import { cleanPictureName, freeFileName } from "./picture-save-http";
import { checkFileBytes, kindOfName, readTableFile, serveFileOpen, serveFileSave, type TableOpenDeps, type TableSaveDeps } from "./table-file-http";

const ZIP = Buffer.from([0x50, 0x4b, 3, 4, 0, 0]);

describe("freeFileName for csv and xlsx", () => {
  it("numbers a taken name and keeps the extension", () => {
    const taken = new Set(["Farm.csv", "Farm (2).csv"]);
    expect(freeFileName("Farm", (name) => taken.has(name), "csv")).toBe("Farm (3).csv");
    expect(freeFileName("Book", (name) => taken.has(name), "xlsx")).toBe("Book.xlsx");
  });
});

describe("kindOfName", () => {
  it("knows .csv and .xlsx in any case, and nothing else", () => {
    expect(kindOfName("C:\\a\\Farm.CSV")).toBe("csv");
    expect(kindOfName("/x/book.xlsx")).toBe("xlsx");
    for (const name of ["a.xls", "a.ods", "a.json", "a.csv.exe", "a", "xlsx", "a.csv "]) expect(kindOfName(name), name).toBeUndefined();
  });
});

describe("checkFileBytes", () => {
  it("takes UTF-8 text as csv and a zip as xlsx", () => {
    expect(() => checkFileBytes("csv", Buffer.from("a;b\nÄ;2\n"))).not.toThrow();
    expect(() => checkFileBytes("xlsx", ZIP)).not.toThrow();
  });
  it("refuses a csv that is not UTF-8 and an xlsx that is not a zip", () => {
    expect(() => checkFileBytes("csv", Buffer.from([0xff, 0xfe, 0x00]))).toThrow(/UTF-8/);
    expect(() => checkFileBytes("xlsx", Buffer.from("a,b\n"))).toThrow(/xlsx/);
    expect(() => checkFileBytes("xlsx", Buffer.alloc(0))).toThrow(/xlsx/);
  });
});

describe("serveFileSave", () => {
  function deps(allowed = true, closed = false) {
    const state = { allowed, saved: [] as { data: Buffer; name: string; kind: FileKind }[] };
    const value: TableSaveDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false),
      save: async (data, name, kind) => {
        if (closed) return null;
        state.saved.push({ data, name, kind });
        return `${name}.${kind}`;
      },
    };
    return { state, value };
  }
  const post = (body: Uint8Array | string | null, type: string | null = "csv", name = "Farm 1") => {
    const url = new URL("tavora-module://sheets/_files/save/");
    if (type) url.searchParams.set("type", type);
    url.searchParams.set("name", name);
    return { request: new Request(url, { method: "POST", body: body as BodyInit | null }), url };
  };
  const save = (p: ReturnType<typeof post>, d: TableSaveDeps) => serveFileSave(p.request, p.url, d, cleanPictureName);

  it("saves a csv and an xlsx after a click under a cleaned name, once per click", async () => {
    const { state, value } = deps();
    const response = await save(post("a,b\n1,2\n", "csv", "Farm/1"), value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: "Farm 1.csv" });
    expect(state.saved).toEqual([{ data: Buffer.from("a,b\n1,2\n"), name: "Farm 1", kind: "csv" }]);
    expect((await save(post("x"), value)).status).toBe(403);
    const next = deps();
    expect(await (await save(post(ZIP, "xlsx", "Book"), next.value)).json()).toEqual({ fileName: "Book.xlsx" });
    expect(next.state.saved[0]!.kind).toBe("xlsx");
  });

  it("answers null when the user closed the save dialog", async () => {
    const response = await save(post("a"), deps(true, true).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fileName: null });
  });

  it("refuses without a click, any other kind, a body that is not that kind, no body and a GET; nothing is shown", async () => {
    expect((await save(post("a"), deps(false).value)).status).toBe(403);
    const { state, value } = deps();
    for (const type of [null, "json", "xls", "ods", "exe", "csv,xlsx"]) expect((await save(post("a", type), deps().value)).status, String(type)).toBe(415);
    expect((await save(post("not a zip", "xlsx"), value)).status).toBe(415);
    expect((await save(post(Buffer.from([0xff, 0xfe, 0x00]), "csv"), deps().value)).status).toBe(415);
    expect((await save(post(null), deps().value)).status).toBe(415);
    expect(state.saved).toHaveLength(0);
    const get = new URL("tavora-module://sheets/_files/save/?type=csv");
    expect((await serveFileSave(new Request(get), get, value, cleanPictureName)).status).toBe(405);
  });

  it("refuses more than 8 MiB", async () => {
    const { state, value } = deps();
    expect((await save(post("x".repeat(MAX_FILE_BYTES + 1)), value)).status).toBe(413);
    expect(state.saved).toHaveLength(0);
    expect((await save(post("x".repeat(MAX_FILE_BYTES)), deps().value)).status).toBe(200);
  });
});

describe("serveFileOpen", () => {
  function deps(picked: { fileName: string; kind: FileKind; bytes: Buffer } | null, allowed = true) {
    const state = { allowed, opened: [] as FileKind[][] };
    const value: TableOpenDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false),
      open: async (kinds) => {
        state.opened.push(kinds);
        return picked;
      },
    };
    return { state, value };
  }
  const url = (types?: string) => new URL(`tavora-module://sheets/_files/open/${types === undefined ? "" : `?types=${types}`}`);
  const post = (types?: string) => ({ request: new Request(url(types), { method: "POST" }), url: url(types) });
  const open = (types: string | undefined, d: TableOpenDeps) => {
    const p = post(types);
    return serveFileOpen(p.request, p.url, d);
  };

  it("answers the bytes with the name and kind in headers, once per click", async () => {
    const { state, value } = deps({ fileName: "Größe 1.csv", kind: "csv", bytes: Buffer.from("a;b\n") });
    const response = await open("csv", value);
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get("X-Tavora-File-Name")!)).toBe("Größe 1.csv");
    expect(response.headers.get("X-Tavora-File-Kind")).toBe("csv");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("a;b\n");
    expect(state.opened).toEqual([["csv"]]);
    expect((await open("csv", value)).status).toBe(403);
  });

  it("offers both kinds when none are named, and each once", async () => {
    const { state, value } = deps({ fileName: "b.xlsx", kind: "xlsx", bytes: ZIP });
    await open(undefined, value);
    expect(state.opened).toEqual([["csv", "xlsx"]]);
    const again = deps(null);
    await open("xlsx,xlsx,csv", again.value);
    expect(again.state.opened).toEqual([["xlsx", "csv"]]);
  });

  it("answers null when the user closed the dialog", async () => {
    const response = await open("csv", deps(null).value);
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("refuses without a click, another kind, and a GET; the dialog is not even shown", async () => {
    const { state, value } = deps({ fileName: "a.csv", kind: "csv", bytes: Buffer.from("a") }, false);
    expect((await open("csv", value)).status).toBe(403);
    expect(state.opened).toHaveLength(0);
    for (const types of ["json", "csv,xls", "", "ods"]) {
      const fresh = deps({ fileName: "a.csv", kind: "csv", bytes: Buffer.from("a") });
      expect((await open(types, fresh.value)).status, types).toBe(415);
      expect(fresh.state.opened).toHaveLength(0);
    }
    expect((await serveFileOpen(new Request(url("csv")), url("csv"), value)).status).toBe(405);
  });
});

describe("readTableFile", () => {
  it("reads a small file, and refuses one over 8 MiB or a folder", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-table-"));
    try {
      const small = path.join(dir, "a.csv");
      await writeFile(small, "a,b\n");
      expect((await readTableFile(small)).toString()).toBe("a,b\n");
      const big = path.join(dir, "big.xlsx");
      await writeFile(big, Buffer.alloc(MAX_FILE_BYTES + 1, 32));
      await expect(readTableFile(big)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      await expect(readTableFile(dir)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
