import { describe, expect, it } from "vitest";
import { ModuleNotesSeen } from "./module-notes-seen";
import type { InstalledModule, ModuleInfo } from "./registry";

const KEY = "0123456789abcdef0123456789abcdef";

function module(owner: string, id: string, version: string, builtIn = false): InstalledModule {
  return { owner, builtIn, manifest: { id, version } } as unknown as InstalledModule;
}

function setup(installed: InstalledModule[], seen: Record<string, string> = {}) {
  const calls: string[] = [];
  const library = { moduleNotesSeen: { ...seen } };
  const modules = new Map(installed.map((item) => [item.manifest.id, item]));
  const changelog = [{ version: "1.0.0", notes: ["First"] }, { version: "1.1.0", notes: ["Maps"] }, { version: "2.0.0", notes: ["Not out yet"] }];
  const info = new Map(installed.map((item) => [item.manifest.id, { changelog } as unknown as ModuleInfo]));
  const notes = new ModuleNotesSeen({ library, saveLibrary: () => void calls.push("library saved"), installed: { modules, get: (id) => modules.get(id), info } });
  return { notes, calls, library };
}

describe("ModuleNotesSeen", () => {
  it("counts a module seen for the first time as read up to its version, by publisher and id, and skips built-in ones", () => {
    const { notes, calls, library } = setup([module(KEY, "acme.map", "1.1.0"), module("official", "tavora.notes", "1.0.0", true)], { "local:acme.map": "1.0.0" });
    notes.noteNew();
    // Another publisher's module with the same id starts fresh.
    expect(library.moduleNotesSeen).toEqual({ "local:acme.map": "1.0.0", [`${KEY}:acme.map`]: "1.1.0" });
    expect(calls).toEqual(["library saved"]);
    // Nothing new: nothing saved.
    notes.noteNew();
    expect(calls).toEqual(["library saved"]);
  });

  it("shows the newest notes the installed version covers, and whether any are new until the user reads them", () => {
    const map = module(KEY, "acme.map", "1.1.0");
    const { notes, calls } = setup([map], { [`${KEY}:acme.map`]: "1.0.0" });
    expect(notes.view(map)).toEqual({ latest: "1.1.0", unseen: true });
    notes.seen("acme.map");
    expect(calls).toEqual(["library saved"]);
    expect(notes.view(map)).toEqual({ latest: "1.1.0", unseen: false });
  });

  it("ignores reading the notes of a module that isn't installed or is built in", () => {
    const { notes, calls, library } = setup([module("official", "tavora.notes", "1.0.0", true)]);
    notes.seen("tavora.notes");
    notes.seen("acme.missing");
    expect(calls).toEqual([]);
    expect(library.moduleNotesSeen).toEqual({});
  });
});
