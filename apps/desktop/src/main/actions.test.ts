import { describe, expect, it } from "vitest";
import { parseAction } from "./actions";

const FOLDER = "123e4567-e89b-42d3-a456-426614174000";

describe("parseAction", () => {
  it.each([
    [{ type: "show-welcome" }],
    [{ type: "open-game", gameId: "poe2" }],
    [{ type: "add-game", catalogId: "elden-ring" }],
    [{ type: "add-game", name: "My Game" }],
    [{ type: "rename-game", gameId: "local-x", name: "New" }],
    [{ type: "set-game-label", gameId: "poe2", label: null }],
    [{ type: "favorite", gameId: "poe2", index: 0 }],
    [{ type: "favorite", gameId: "poe2" }],
    [{ type: "move-game", gameId: "poe2", folderId: null }],
    [{ type: "move-game", gameId: "poe2", folderId: FOLDER, index: 3 }],
    [{ type: "create-folder", name: "ARPGs", gameIds: ["poe2", "diablo-4"] }],
    [{ type: "move-folder", folderId: FOLDER, index: 1 }],
    [{ type: "set-sort", sort: "manual" }],
    [{ type: "set-startup", startup: "welcome" }],
    [{ type: "set-rail", expanded: true }],
    [{ type: "set-rail", width: 300 }],
    [{ type: "open-module", moduleId: "local.example.vue-module" }],
    [{ type: "close-panel", instanceId: FOLDER }],
  ])("accepts %j", (action) => {
    expect(parseAction(action)).toEqual(action);
  });

  it.each([
    [null],
    ["show-welcome"],
    [{ type: "nope" }],
    [{ type: "show-welcome", extra: 1 }],
    [{ type: "open-game", gameId: "../poe2" }],
    [{ type: "open-game" }],
    [{ type: "add-game", catalogId: "poe2", name: "x" }],
    [{ type: "add-game", name: "x".repeat(201) }],
    [{ type: "set-game-label", gameId: "poe2", label: 3 }],
    [{ type: "favorite", gameId: "poe2", index: -1 }],
    [{ type: "favorite", gameId: "poe2", index: 1.5 }],
    [{ type: "move-game", gameId: "poe2", folderId: "not-a-uuid" }],
    [{ type: "move-game", gameId: "poe2" }],
    [{ type: "create-folder", name: "F", gameIds: ["../x"] }],
    [{ type: "move-folder", folderId: FOLDER }],
    [{ type: "set-sort", sort: "alpha" }],
    [{ type: "set-rail", width: Number.POSITIVE_INFINITY }],
    [{ type: "set-rail", expanded: "yes" }],
    [{ type: "open-module", moduleId: "Bad Id" }],
    [{ type: "close-panel", instanceId: "../x" }],
  ])("rejects %j", (action) => {
    expect(parseAction(action)).toBeNull();
  });
});
