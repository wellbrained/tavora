// Undo of a delete (layouts, folders, workspaces moved to Trash): what goes back, where, and when it can't.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWorkspace,
  createFolder,
  deleteFolderUndoably,
  deleteTrashedWorkspace,
  emptyLibrary,
  LibraryError,
  moveWorkspace,
  placeFavorite,
  restoreFolder,
  restoreWorkspace,
  trashWorkspace,
  untrashWorkspace,
  untrashWorkspaces,
  workspacePlace,
  type Library,
} from "./library";
import { UndoShelf } from "./undo-shelf";
import { emptyWorkspaces, MAX_SNAPSHOTS, Workspaces, WorkspaceError, type WorkspaceState } from "./workspace";
import type { SavedLayout } from "./layout";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
const rootIds = (library: Library) => library.root.map((item) => `${item.kind}:${item.id}`);

/** Workspaces a, b, c, d at the top level, in that order. */
function library(): Library {
  const made = emptyLibrary();
  for (const [index, name] of ["a", "b", "c", "d"].entries()) addWorkspace(made, { name }, day(1 + index));
  return made;
}
const id = (name: string) => `local-${name}`;

describe("a workspace moved to Trash, undone", () => {
  it("goes back to its place at the top level, its favorite slot and as the last one open", () => {
    const lib = library();
    placeFavorite(lib, id("d"));
    placeFavorite(lib, id("b"));
    lib.lastWorkspaceId = id("b");
    const before = structuredClone(lib);
    const where = workspacePlace(lib, id("b"));
    trashWorkspace(lib, id("b"), day(9));
    expect(rootIds(lib)).not.toContain(`workspace:${id("b")}`);
    untrashWorkspace(lib, id("b"), where);
    expect(lib).toEqual(before);
  });

  it("goes back into its folder, at its place there", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("a"), id("b"), id("c")]);
    const where = workspacePlace(lib, id("b"));
    trashWorkspace(lib, id("b"), day(9));
    untrashWorkspace(lib, id("b"), where);
    expect(lib.folders[folder]!.workspaces).toEqual([id("a"), id("b"), id("c")]);
  });

  it("two in quick succession: undoing the first keeps the second in Trash, then both are back in order", () => {
    const lib = library();
    const before = rootIds(lib);
    const first = workspacePlace(lib, id("a"));
    trashWorkspace(lib, id("a"), day(9));
    const second = workspacePlace(lib, id("c"));
    trashWorkspace(lib, id("c"), day(9));
    untrashWorkspace(lib, id("a"), first);
    expect(lib.workspaces[id("c")]!.trashedAt).not.toBeNull();
    expect(rootIds(lib)).toEqual(before.filter((item) => item !== `workspace:${id("c")}`));
    untrashWorkspace(lib, id("c"), second);
    expect(rootIds(lib)).toEqual(before);
  });

  it("its folder was deleted too: it comes back at the top level", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("b"), id("c")]);
    const where = workspacePlace(lib, id("b"));
    trashWorkspace(lib, id("b"), day(9));
    deleteFolderUndoably(lib, folder);
    untrashWorkspace(lib, id("b"), where);
    expect(rootIds(lib)).toContain(`workspace:${id("b")}`);
    expect(lib.workspaces[id("b")]!.trashedAt).toBeNull();
  });

  it("then the folder's undo takes it back in as well, when the folder comes back first", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("b"), id("c")]);
    const where = workspacePlace(lib, id("b"));
    trashWorkspace(lib, id("b"), day(9));
    const deleted = deleteFolderUndoably(lib, folder);
    restoreFolder(lib, deleted);
    untrashWorkspace(lib, id("b"), where);
    expect(lib.folders[folder]!.workspaces).toEqual([id("b"), id("c")]);
  });

  it("restored from Trash meanwhile: nothing changes; deleted for good: can't be undone", () => {
    const lib = library();
    const where = workspacePlace(lib, id("b"));
    trashWorkspace(lib, id("b"), day(9));
    restoreWorkspace(lib, id("b"));
    const now = rootIds(lib);
    untrashWorkspace(lib, id("b"), where);
    expect(rootIds(lib)).toEqual(now);
    trashWorkspace(lib, id("b"), day(9));
    deleteTrashedWorkspace(lib, id("b"));
    expect(() => untrashWorkspace(lib, id("b"), where)).toThrow(LibraryError);
  });
});

describe("a folder, deleted and undone", () => {
  it("comes back with its id, name, label and workspaces, where it was", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("b"), id("c")]);
    lib.folders[folder]!.label = "R";
    const before = structuredClone(lib);
    const deleted = deleteFolderUndoably(lib, folder);
    expect(lib.folders[folder]).toBeUndefined();
    expect(rootIds(lib)).toEqual([`workspace:${id("a")}`, `workspace:${id("b")}`, `workspace:${id("c")}`, `workspace:${id("d")}`]);
    restoreFolder(lib, deleted);
    expect(lib).toEqual(before);
  });

  it("leaves out a workspace that moved elsewhere or went to Trash since", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("a"), id("b"), id("c")]);
    const deleted = deleteFolderUndoably(lib, folder);
    const other = createFolder(lib, "Other", [id("a")]);
    trashWorkspace(lib, id("c"), day(9));
    restoreFolder(lib, deleted);
    expect(lib.folders[folder]!.workspaces).toEqual([id("b")]);
    expect(lib.folders[other]!.workspaces).toEqual([id("a")]);
  });

  it("can't come back twice", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("b")]);
    const deleted = deleteFolderUndoably(lib, folder);
    restoreFolder(lib, deleted);
    expect(() => restoreFolder(lib, deleted)).toThrow(LibraryError);
  });

  it("keeps its place when a workspace before it was moved meanwhile", () => {
    const lib = library();
    const folder = createFolder(lib, "Raid", [id("c")]);
    const deleted = deleteFolderUndoably(lib, folder);
    moveWorkspace(lib, id("a"), { folderId: null });
    restoreFolder(lib, deleted);
    expect(rootIds(lib)).toEqual([`workspace:${id("b")}`, `folder:${folder}`, `workspace:${id("d")}`, `workspace:${id("a")}`]);
  });
});

describe("a layout, deleted and undone", () => {
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const twoColumns = (left: string, right: string): SavedLayout => ({
    width: 1000,
    height: 600,
    direction: "row",
    root: {
      kind: "split",
      size: 600,
      children: [
        { kind: "group", size: 500, panels: [left], active: left },
        { kind: "group", size: 500, panels: [right], active: right },
      ],
    },
  });
  const setup = () => {
    const state: WorkspaceState = emptyWorkspaces(["poe2", "satisfactory"]);
    state.workspaces.poe2 = { instances: [{ instanceId: A, moduleId: "notes" }, { instanceId: B, moduleId: "todos" }], layout: twoColumns(A, B), snapshots: [] };
    let next = 0;
    const workspaces = new Workspaces(state, {
      save: () => undefined,
      newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });
    return { state, workspaces };
  };

  it("comes back with its id, contents and place in the list", () => {
    const { state, workspaces } = setup();
    for (const name of ["One", "Two", "Three"]) workspaces.saveSnapshot("poe2", name);
    const before = structuredClone(state.workspaces.poe2!.snapshots);
    const deleted = workspaces.deleteSnapshotUndoably("poe2", before[1]!.id);
    expect(state.workspaces.poe2!.snapshots.map((item) => item.name)).toEqual(["One", "Three"]);
    workspaces.restoreSnapshot(deleted);
    expect(state.workspaces.poe2!.snapshots).toEqual(before);
  });

  it("goes back into the workspace it was deleted in, whichever is open now", () => {
    const { state, workspaces } = setup();
    const snapshotId = workspaces.saveSnapshot("poe2", "Mapping");
    const deleted = workspaces.deleteSnapshotUndoably("poe2", snapshotId);
    // The user switched to satisfactory meanwhile; the host gives the shelf what it kept, not the open workspace.
    workspaces.restoreSnapshot(deleted);
    expect(state.workspaces.poe2!.snapshots.map((item) => item.id)).toEqual([snapshotId]);
    expect(state.workspaces.satisfactory!.snapshots).toEqual([]);
  });

  it("one saved under the same name meanwhile keeps it; the one coming back gets a number", () => {
    const { state, workspaces } = setup();
    const snapshotId = workspaces.saveSnapshot("poe2", "Mapping");
    const deleted = workspaces.deleteSnapshotUndoably("poe2", snapshotId);
    const fresh = workspaces.saveSnapshot("poe2", "mapping");
    workspaces.restoreSnapshot(deleted);
    expect(state.workspaces.poe2!.snapshots.map((item) => [item.id, item.name])).toEqual([
      [snapshotId, "Mapping (2)"],
      [fresh, "mapping"],
    ]);
  });

  it("can't come back twice, into a workspace that is gone, or into a full list", () => {
    const { state, workspaces } = setup();
    const snapshotId = workspaces.saveSnapshot("poe2", "Mapping");
    const deleted = workspaces.deleteSnapshotUndoably("poe2", snapshotId);
    workspaces.restoreSnapshot(deleted);
    expect(() => workspaces.restoreSnapshot(deleted)).toThrow(WorkspaceError);
    const again = workspaces.deleteSnapshotUndoably("poe2", snapshotId);
    for (let index = 0; index < MAX_SNAPSHOTS; index++) workspaces.saveSnapshot("poe2", `L${index}`);
    expect(() => workspaces.restoreSnapshot(again)).toThrow(WorkspaceError);
    delete state.workspaces.poe2;
    expect(() => workspaces.restoreSnapshot(again)).toThrow(WorkspaceError);
  });
});

describe("UndoShelf", () => {
  afterEach(() => vi.useRealTimers());

  it("puts a delete back once, under its own token", async () => {
    const shelf = new UndoShelf();
    const back: string[] = [];
    const first = shelf.put(() => back.push("first"));
    const second = shelf.put(() => back.push("second"));
    expect(first).not.toBe(second);
    await shelf.restore(first);
    expect(back).toEqual(["first"]);
    await expect(shelf.restore(first)).rejects.toThrow("Can't undo that anymore.");
    await shelf.restore(second);
    expect(back).toEqual(["first", "second"]);
  });

  it("forgets a token when the toast's time is up, and on its own after a while", async () => {
    vi.useFakeTimers();
    const shelf = new UndoShelf(1000);
    const token = shelf.put(() => undefined);
    shelf.forget(token);
    await expect(shelf.restore(token)).rejects.toThrow();
    const late = shelf.put(() => undefined);
    vi.advanceTimersByTime(1001);
    expect(shelf.size).toBe(0);
    await expect(shelf.restore(late)).rejects.toThrow();
  });

  it("passes on why a put-back failed, and the token is used up", async () => {
    const shelf = new UndoShelf();
    const token = shelf.put(() => {
      throw new LibraryError("error.undo.gone");
    });
    await expect(shelf.restore(token)).rejects.toThrow(LibraryError);
    expect(shelf.size).toBe(0);
  });
});

describe("several workspaces moved to Trash together, undone", () => {
  it("bring back those still there when one was deleted for good meanwhile, each in its place", () => {
    const lib = library();
    const before = rootIds(lib);
    const places = [id("a"), id("b"), id("c")].map((name) => ({ id: name, where: workspacePlace(lib, name) }));
    for (const { id: name } of places) trashWorkspace(lib, name, day(9));
    deleteTrashedWorkspace(lib, id("b"));
    expect(untrashWorkspaces(lib, places)).toEqual([id("a"), id("c")]);
    expect(rootIds(lib)).toEqual(before.filter((item) => item !== `workspace:${id("b")}`));
  });

  it("can't be undone when none of them is left", () => {
    const lib = library();
    const places = [{ id: id("a"), where: workspacePlace(lib, id("a")) }];
    trashWorkspace(lib, id("a"), day(9));
    deleteTrashedWorkspace(lib, id("a"));
    expect(() => untrashWorkspaces(lib, places)).toThrow(LibraryError);
  });
});
