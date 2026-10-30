import type { JsonValue } from "@tavora/sdk";
import { createMemoryHost, type MemoryHost, type MemoryHostOptions } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { openBoardLibrary, type OpenBoardView } from "./board-library";
import { emptyBoard, newBoardId, parseBoard, type BoardData } from "./boards";

const words = () => ({ board: "Board", idea: "Idea board", screenshot: "Screenshot annotation" });

/** Two panels of the Whiteboard on one workspace. */
function panels(options: MemoryHostOptions = {}) {
  const a = createMemoryHost(options);
  const b = createMemoryHost({ ...options, share: a.host });
  return { a, b };
}

const open = (sdk: ReturnType<typeof createMemoryHost>["sdk"]) => openBoardLibrary(sdk, { words, debounceMs: 0 });

const drawing = (patch: Partial<BoardData> = {}): BoardData => ({ ...emptyBoard(), elements: [{ id: "r1", type: "rectangle" }], ...patch });

/** Puts a board into the shared documents as another panel (or an earlier run) would. */
function seed(host: MemoryHost, id: string, name: string, data: Partial<BoardData> = {}) {
  host.documents.put({ id, title: name, data: { ...drawing(), ...data, name } as unknown as JsonValue });
}

const stored = (host: MemoryHost, id: string) => {
  const document = host.documents.get(id);
  return document ? { title: document.title, data: parseBoard(document.data) } : undefined;
};
const titles = (host: MemoryHost) => host.documents.list().map((entry) => entry.title).sort();

describe("the first board", () => {
  it("makes a starter board when there is none, named after the language", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    expect(library.boards.map((board) => board.name)).toEqual(["Board 1"]);
    expect(library.currentId).toBe("board-start");
    expect(stored(a.host, "board-start")?.title).toBe("Board 1");
    expect(stored(a.host, "board-start")?.data.name).toBe("Board 1");
  });

  it("makes it once when two panels start together", async () => {
    const { a, b } = panels();
    const [first, second] = await Promise.all([open(a.sdk), open(b.sdk)]);
    expect(titles(a.host)).toEqual(["Board 1"]);
    expect(first.currentId).toBe("board-start");
    expect(second.currentId).toBe("board-start");
  });

  it("opens the board that is there instead", async () => {
    const { a } = panels();
    seed(a.host, newBoardId(), "Atlas");
    const library = await open(a.sdk);
    expect(titles(a.host)).toEqual(["Atlas"]);
    expect(library.current?.data.name).toBe("Atlas");
  });
});

describe("making boards", () => {
  it("numbers blank boards after the ones that exist and keeps starter names apart", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    await library.create("blank");
    expect(library.boards.map((board) => board.name)).toEqual(["Board 1", "Board 2"]);
    await library.create("idea", drawing());
    await library.create("idea", drawing());
    await library.create("screenshot", drawing());
    await library.create("blank");
    expect(titles(a.host)).toEqual(["Board 1", "Board 2", "Board 6", "Idea board", "Idea board 2", "Screenshot annotation"]);
  });

  it("skips a name that is taken whatever its case, and opens the new board", async () => {
    const { a } = panels();
    seed(a.host, newBoardId(), "idea BOARD");
    const library = await open(a.sdk);
    const id = await library.create("idea", drawing());
    expect(library.currentId).toBe(id);
    expect(library.current?.data.name).toBe("Idea board 2");
    expect(library.current?.data.elements).toHaveLength(1);
    expect(stored(a.host, id)?.title).toBe("Idea board 2");
  });

  it("keeps boards in the order they were made, the starter board first", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    // Ids made in the same millisecond have no order between them, so these are given.
    const second = await library.create("blank", emptyBoard(), newBoardId(1_700_000_000_000, 0.1));
    const third = await library.create("blank", emptyBoard(), newBoardId(1_700_000_001_000, 0.1));
    expect(library.boards.map((board) => board.id)).toEqual(["board-start", second, third]);
  });

  it("uses the id it is given", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    const id = newBoardId();
    expect(await library.create("blank", emptyBoard(), id)).toBe(id);
    expect(library.currentId).toBe(id);
  });
});

describe("renaming", () => {
  it("changes the title and the board's name, trims it, and ignores an empty or unchanged one", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    await library.rename("board-start", "  Atlas \n map ");
    expect(library.boards[0]?.name).toBe("Atlas map");
    expect(stored(a.host, "board-start")).toMatchObject({ title: "Atlas map", data: { name: "Atlas map" } });
    const revision = a.host.documents.get("board-start")!.revision;
    await library.rename("board-start", "Atlas map");
    await library.rename("board-start", "   ");
    expect(a.host.documents.get("board-start")!.revision).toBe(revision);
  });

  it("renames a board that is not open", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    const other = await library.create("blank");
    await library.rename("board-start", "First");
    expect(stored(a.host, "board-start")?.title).toBe("First");
    expect(library.currentId).toBe(other);
  });

  it("brings the name of an older board, which only had it as the title, into its data", async () => {
    const { a } = panels();
    a.host.documents.put({ id: newBoardId(), title: "Old board", data: { version: 1, elements: [] } });
    const library = await open(a.sdk);
    expect(library.current?.data.name).toBe("Old board");
    await library.current!.flush();
    const saved = a.host.documents.list()[0]!;
    expect(saved.title).toBe("Old board");
    expect(parseBoard(a.host.documents.get(saved.id)!.data).name).toBe("Old board");
  });
});

describe("two panels", () => {
  it("shows another panel's save of the open board, and its new boards", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    const heard: string[] = [];
    second.onChange((event) => event.type === "current" && heard.push(event.source));

    first.current!.update((draft) => void (draft.elements = [{ id: "r1", type: "rectangle" }]));
    await first.current!.flush();
    await vi.waitFor(() => expect(second.current?.data.elements).toHaveLength(1));
    expect(heard).toContain("remote");

    const id = await first.create("blank");
    await vi.waitFor(() => expect(second.boards.map((board) => board.id)).toContain(id));
    // The other panel stays on its board; a panel never switches by itself.
    expect(second.currentId).toBe("board-start");
  });

  it("keeps this panel's drawing when another panel saved first (the board is edited whole)", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    const second = await open(b.sdk);
    const mine = [{ id: "mine", type: "ellipse" }];
    first.current!.update((draft) => void (draft.elements = mine));
    second.current!.update((draft) => void (draft.elements = [{ id: "theirs", type: "diamond" }]));
    await second.current!.flush();
    await first.current!.flush();
    expect(stored(a.host, "board-start")?.data.elements).toEqual(mine);
  });

  it("keeps a board open when another panel deletes it, and brings it back on request", async () => {
    const { a, b } = panels();
    const first = await open(a.sdk);
    await open(b.sdk);
    first.current!.update((draft) => void (draft.elements = [{ id: "r1", type: "rectangle" }]));
    await first.current!.flush();
    const events: boolean[] = [];
    first.onChange((event) => event.type === "current" && events.push(event.deleted));

    b.host.documents.delete("board-start");
    await vi.waitFor(() => expect(first.deleted).toBe(true));
    expect(first.currentId).toBe("board-start");
    expect(events).toContain(true);
    await vi.waitFor(() => expect(first.boards).toHaveLength(0));
    expect(a.host.documents.get("board-start")).toBeNull();

    await first.restoreDeleted();
    expect(first.deleted).toBe(false);
    expect(first.currentId).toBe("board-start");
    expect(stored(a.host, "board-start")).toMatchObject({ title: "Board 1", data: { name: "Board 1", elements: [{ id: "r1" }] } });
    expect(first.boards.map((board) => board.name)).toEqual(["Board 1"]);
  });
});

describe("deleting", () => {
  it("opens a neighbour, and Undo brings the board back as it was and opens it", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    library.current!.update((draft) => void (draft.elements = [{ id: "r1", type: "rectangle" }]));
    const second = await library.create("blank");
    await library.rename(second, "Atlas map");

    const undo = await library.remove(second);
    expect(a.host.documents.get(second)).toBeNull();
    expect(library.currentId).toBe("board-start");
    expect(library.boards.map((board) => board.name)).toEqual(["Board 1"]);

    await undo();
    expect(library.currentId).toBe(second);
    expect(titles(a.host)).toEqual(["Atlas map", "Board 1"]);
    expect(stored(a.host, "board-start")?.data.elements).toHaveLength(1);
  });

  it("makes a new blank board when the last one is deleted", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    await library.remove("board-start");
    expect(library.boards.map((board) => board.name)).toEqual(["Board 1"]);
    expect(library.currentId).not.toBeNull();
    expect(library.currentId).not.toBe("board-start");
  });

  it("deletes the copy another panel saved meanwhile", async () => {
    const { a, b } = panels();
    const library = await open(a.sdk);
    const other = await library.create("blank");
    await library.open("board-start");
    // Another panel saves the board after this panel read the list.
    b.host.documents.put({ id: other, title: "Edited", data: { ...emptyBoard(), name: "Edited" } as unknown as JsonValue, ifRevision: 1 });
    await library.remove(other);
    expect(a.host.documents.get(other)).toBeNull();
  });

  it("lets the open board's view go without storing what it has left", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    const view: OpenBoardView = { flush: vi.fn(async () => undefined), discard: vi.fn() };
    library.attach(view);
    const second = await library.create("blank");
    expect(view.flush).toHaveBeenCalled();
    await library.remove(second);
    expect(view.discard).toHaveBeenCalled();
  });
});

describe("restoring and navigating", () => {
  it("opens the board the panel showed before a restart", async () => {
    const { a } = panels();
    seed(a.host, "board-000000001-aaaa", "First");
    seed(a.host, "board-000000002-bbbb", "Second");
    const again = createMemoryHost({ share: a.host, launch: { reason: "restore", content: { id: "board-000000001-aaaa", title: "First" } } });
    expect((await open(again.sdk)).currentId).toBe("board-000000001-aaaa");
  });

  it("falls back to the board older versions remembered in the panel state", async () => {
    const { a } = panels();
    seed(a.host, "board-000000001-aaaa", "First");
    seed(a.host, "board-000000002-bbbb", "Second");
    const older = createMemoryHost({ share: a.host, launch: { reason: "restore", content: null } });
    await older.sdk.panel.setState({ selected: "board-000000002-bbbb" });
    expect((await open(older.sdk)).currentId).toBe("board-000000002-bbbb");
  });

  it("shows the board another panel asks for with panels.open, after storing the open one", async () => {
    const { a } = panels();
    seed(a.host, "board-000000001-aaaa", "First");
    const library = await open(a.sdk);
    const view: OpenBoardView = { flush: vi.fn(async () => undefined), discard: vi.fn() };
    library.attach(view);
    expect(await a.host.navigate({ id: "board-000000001-aaaa", title: "First" })).toEqual({ handled: true, ok: true });
    expect(view.flush).toHaveBeenCalled();
    expect(library.currentId).toBe("board-000000001-aaaa");
    expect(a.host.content).toMatchObject({ id: "board-000000001-aaaa" });
    expect(await a.host.navigate({ id: "board-nothing", title: "Nope" })).toEqual({ handled: true, ok: false });
    expect(library.currentId).toBe("board-000000001-aaaa");
  });

  it("stores the open board before another one is opened", async () => {
    const { a } = panels();
    const library = await open(a.sdk);
    const second = await library.create("blank");
    const view: OpenBoardView = { flush: vi.fn(async () => undefined), discard: vi.fn() };
    library.attach(view);
    await library.open("board-start");
    expect(view.flush).toHaveBeenCalled();
    expect(library.currentId).toBe("board-start");
    expect(library.boards).toHaveLength(2);
    expect(library.boards.some((board) => board.id === second)).toBe(true);
  });
});

describe("pictures in use", () => {
  it("lists the stored files of every board", async () => {
    const { a } = panels();
    const blob = await a.sdk.blobs.put(new Blob(["x"], { type: "image/png" }));
    seed(a.host, newBoardId(), "With a picture", { files: { f1: { blobId: blob.id, mimeType: "image/png", created: 1 } } });
    seed(a.host, newBoardId(), "Without");
    seed(a.host, "notes", "Not a board", { files: { f2: { blobId: "c".repeat(32), mimeType: "image/png", created: 1 } } });
    const library = await open(a.sdk);
    expect([...(await library.usedFiles())]).toEqual([blob.id]);
  });
});
