import { describe, expect, it } from "vitest";
import { problems, raised, touchedModules } from "./check-module-versions.mjs";

const MODULES = ["notes", "playground", "todos"];

describe("check-module-versions", () => {
  it("finds the modules whose shipped files changed, and all of them for a kit change", () => {
    expect(touchedModules(["modules/notes/src/App.vue", "modules/notes/src/notes.test.ts", "apps/desktop/src/x.ts"], MODULES)).toEqual(["notes"]);
    expect(touchedModules(["modules/shared/src/lib/keys.ts"], MODULES)).toEqual(MODULES);
    expect(touchedModules(["modules/shared/src/lib/keys.test.ts", "modules/todos/README.md", "modules/README.md", "modules/todos/src/__snapshots__/a.snap"], MODULES)).toEqual([]);
  });

  it("compares versions by their numbers", () => {
    expect(raised("0.1.9", "0.1.10")).toBe(true);
    expect(raised("0.1.65", "0.2.0")).toBe(true);
    expect(raised("0.1.65", "0.1.65")).toBe(false);
    expect(raised("0.2.0", "0.1.99")).toBe(false);
  });

  it("fails a changed module that kept its version, and skips new or removed ones", () => {
    const versions: Record<string, Record<"base" | "head", string | null>> = {
      notes: { base: "0.6.33", head: "0.6.34" },
      playground: { base: "0.1.65", head: "0.1.65" },
      todos: { base: null, head: "0.1.0" },
    };
    const found = problems(["modules/shared/src/lib/utils.ts"], MODULES, (module: string, side: "base" | "head") => versions[module]![side]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("modules/playground");
  });
});
