import { describe, expect, it } from "vitest";
import { LibraryWorkspaces } from "./workspace-lookup";
import type { Library } from "./library";

const entry = (id: string, kind: "game" | "personal", name: string, trashedAt: string | null = null) => ({ id, kind, name, trashedAt }) as unknown as Library["workspaces"][string];

describe("LibraryWorkspaces", () => {
  const library = { workspaces: { elden: entry("elden", "game", "Elden Ring"), home: entry("home", "personal", "Personal"), old: entry("old", "game", "Old", "2026-01-01") } };
  const workspaces = new LibraryWorkspaces(library);

  it("names a workspace, or null once it is gone", () => {
    expect(workspaces.name("elden")).toBe("Elden Ring");
    expect(workspaces.name("nope")).toBeNull();
  });

  it("tells a personal workspace from a game, and counts an unknown one as a game", () => {
    expect(workspaces.scopeOf("home")).toBe("all");
    expect(workspaces.scopeOf("elden")).toBe("game");
    expect(workspaces.scopeOf("nope")).toBe("game");
  });

  it("lists the live game workspaces", () => {
    expect(workspaces.games()).toEqual([{ id: "elden", name: "Elden Ring" }]);
  });

  it("reads the library as it is now", () => {
    library.workspaces.home = entry("home", "game", "Home");
    expect(workspaces.games().map((game) => game.id)).toEqual(["elden", "home"]);
  });
});
