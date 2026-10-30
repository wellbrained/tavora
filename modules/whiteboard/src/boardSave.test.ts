import { TavoraError, type JsonValue } from "@tavora/sdk";
import { openDocument } from "@tavora/sdk/store";
import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createBoardSaver, type Problem, type Scene, type SceneElement } from "./boardSave";
import type { SaverState } from "./boardSave";
import { boardTitle, emptyBoard, MAX_BOARD_BYTES, parseBoard, type BoardData, type StoredFile } from "./boards";

const ID = "board-000000001-aaaa";
const DELAY = 15;

let nonce = 0;
const rectangle = (extra: Partial<SceneElement> = {}): SceneElement => ({ type: "rectangle", versionNonce: ++nonce, ...extra });
const scene = (elements: SceneElement[], extra: Partial<Scene> = {}): Scene => ({ elements, background: "#ffffff", grid: false, files: {}, ...extra });
const wait = (ms = DELAY * 4) => new Promise((resolve) => setTimeout(resolve, ms));

/** A board that is stored, opened as the board library opens it (a handle that merges as "mine"), and a saver on it. */
async function setup(options: { synced?: Record<string, StoredFile>; problems?: Problem[]; data?: Partial<BoardData> } = {}) {
  const panel = createMemoryHost();
  const other = createMemoryHost({ share: panel.host });
  panel.host.documents.put({ id: ID, title: "Atlas", data: { ...emptyBoard(), name: "Atlas", ...options.data } as unknown as JsonValue });
  const open = (sdk: typeof panel.sdk) => openDocument(sdk, ID, { parse: (raw) => parseBoard(raw), title: boardTitle, merge: "mine", debounceMs: 0 });
  const document = await open(panel.sdk);
  const order: string[] = [];
  const stored = new Map<string, StoredFile>();
  const sync = vi.fn(async (_: unknown, __: unknown) => {
    order.push("sync");
    return { files: options.synced ?? {}, problems: options.problems ?? [] };
  });
  const update = document.update.bind(document);
  document.update = (change) => {
    order.push("update");
    update(change);
  };
  const saver = createBoardSaver({ document, pictures: { sync: sync as never, stored }, delayMs: DELAY });
  const states: SaverState[] = [];
  saver.onState((state) => states.push(state));
  const read = () => {
    const doc = panel.host.documents.get(ID);
    return doc ? parseBoard(doc.data) : undefined;
  };
  return { panel, other, document, saver, states, order, sync, read, open };
}

describe("saving a drawing", () => {
  it("does nothing for a drawing that is already stored", async () => {
    const { saver, panel, read } = await setup();
    const revision = panel.host.documents.get(ID)!.revision;
    saver.change(scene([]));
    await saver.flush();
    expect(saver.state).toMatchObject({ dirty: false, save: "idle" });
    expect(panel.host.documents.get(ID)!.revision).toBe(revision);
    expect(read()?.name).toBe("Atlas");
  });

  it("saves a moment after drawing stops: dirty, saving, saved", async () => {
    const { saver, states, read } = await setup();
    const kept = rectangle();
    saver.change(scene([kept, rectangle({ isDeleted: true })], { background: "#101010", grid: true }));
    expect(saver.state).toMatchObject({ dirty: true, save: "idle" });
    await wait();
    const steps = states.map((state) => `${state.dirty}:${state.save}`).filter((step, at, all) => step !== all[at - 1]);
    expect(steps).toEqual(["true:idle", "true:saving", "false:saved"]);
    // Deleted elements stay out; the name stays.
    expect(read()).toMatchObject({ name: "Atlas", background: "#101010", grid: true, elements: [{ type: "rectangle", versionNonce: kept.versionNonce }] });
  });

  it("saves once for a burst of changes", async () => {
    const { saver, panel } = await setup();
    const revision = panel.host.documents.get(ID)!.revision;
    for (let n = 0; n < 5; n++) {
      saver.change(scene([rectangle()]));
      await wait(DELAY / 3);
    }
    await wait();
    expect(panel.host.documents.get(ID)!.revision).toBe(revision + 1);
  });

  it("stays dirty while a newer drawing waits behind a save that is running", async () => {
    const { saver, states, sync, read } = await setup();
    let release = () => {};
    sync.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ files: {}, problems: [] }))));
    saver.change(scene([rectangle()]));
    await wait();
    expect(saver.state.save).toBe("saving");
    saver.change(scene([rectangle(), rectangle()]));
    release();
    await wait();
    expect(read()?.elements).toHaveLength(2);
    // Never "saved" in between: the first save was not the last word.
    const saved = states.map((state) => state.save);
    expect(saved.filter((state) => state === "saved")).toHaveLength(1);
    expect(saved.at(-1)).toBe("saved");
    expect(saver.state.dirty).toBe(false);
  });

  it("saves what is left when asked to flush", async () => {
    const { saver, read } = await setup();
    saver.change(scene([rectangle()]));
    await saver.flush();
    expect(read()?.elements).toHaveLength(1);
    expect(saver.state).toMatchObject({ dirty: false, save: "saved" });
  });

  it("saves what is left when it is disposed", async () => {
    const { saver, read } = await setup();
    saver.change(scene([rectangle()]));
    await saver.dispose();
    expect(read()?.elements).toHaveLength(1);
  });
});

describe("pictures", () => {
  it("are stored before the board is updated, and the board keeps the stored files", async () => {
    const file: StoredFile = { blobId: "b".repeat(32), mimeType: "image/png", created: 1 };
    const { saver, order, sync, read } = await setup({ synced: { f1: file } });
    const image = rectangle({ type: "image", fileId: "f1" });
    saver.change(scene([image], { files: { f1: {} as never } }));
    await saver.flush();
    expect(order).toEqual(["sync", "update"]);
    expect(sync.mock.calls[0]![0]).toEqual([image]);
    expect(read()?.files).toEqual({ f1: file });
  });

  it("count as a change when their pixels arrive after their element", async () => {
    const { saver, sync } = await setup();
    const image = rectangle({ type: "image", fileId: "f1" });
    saver.change(scene([image]));
    // The element alone is a change to save; the pixels a moment later are one more.
    await saver.flush();
    expect(sync).toHaveBeenCalledTimes(1);
    saver.change(scene([image], { files: { f1: {} as never } }));
    await saver.flush();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("tell the user about the ones that could not be kept", async () => {
    const problem: Problem = { kind: "unsupported", message: "image/svg+xml" };
    const { saver } = await setup({ problems: [problem] });
    const heard: Problem[] = [];
    saver.onProblem((next) => heard.push(next));
    saver.change(scene([rectangle()]));
    await saver.flush();
    expect(heard).toEqual([problem]);
  });
});

describe("when saving fails", () => {
  it("is too big: nothing is stored and the state says so, until it is small again", async () => {
    const { saver, read, panel } = await setup();
    const revision = panel.host.documents.get(ID)!.revision;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    saver.change(scene([{ ...rectangle(), filler: "x".repeat(MAX_BOARD_BYTES + 1) } as SceneElement]));
    await saver.flush();
    expect(saver.state).toMatchObject({ save: "error", dirty: true });
    expect(saver.state.bytes).toBeGreaterThan(MAX_BOARD_BYTES);
    expect(panel.host.documents.get(ID)!.revision).toBe(revision);

    saver.change(scene([rectangle()]));
    await saver.flush();
    expect(saver.state).toMatchObject({ save: "saved", dirty: false });
    expect(read()?.elements).toHaveLength(1);
    error.mockRestore();
  });

  it("is refused by the host: the drawing is kept, shown as an error, and saved on the next try", async () => {
    const { saver, panel, read } = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    panel.host.answer("documents.put", () => {
      throw new TavoraError({ code: "QUOTA_EXCEEDED", message: "disk full" });
    });
    saver.change(scene([rectangle()]));
    await saver.flush();
    expect(saver.state).toMatchObject({ save: "error", dirty: true });
    expect(read()?.elements).toEqual([]);

    panel.host.unanswer("documents.put");
    await saver.flush();
    // The same drawing is tried again, not forgotten.
    expect(saver.state).toMatchObject({ save: "saved", dirty: false });
    expect(read()?.elements).toHaveLength(1);
    error.mockRestore();
  });
});

describe("other panels", () => {
  it("do not undo this panel's drawing: it wins over a save made in between", async () => {
    const { saver, other, open, read } = await setup();
    const theirs = await open(other.sdk);
    theirs.update((draft) => void (draft.elements = [{ id: "theirs", type: "diamond" }]));
    await theirs.flush();
    saver.change(scene([rectangle()]));
    await saver.flush();
    expect(read()?.elements).toHaveLength(1);
    expect(read()?.elements[0]).not.toMatchObject({ id: "theirs" });
  });

  it("deleting the board stops saving, and says so", async () => {
    const { saver, panel, states, read } = await setup();
    panel.host.documents.delete(ID);
    await vi.waitFor(() => expect(saver.state.deleted).toBe(true));
    expect(states.at(-1)?.deleted).toBe(true);
    saver.change(scene([rectangle()]));
    await saver.flush();
    await wait();
    expect(read()).toBeUndefined();
    expect(saver.state.save).toBe("idle");
  });
});

describe("letting go", () => {
  it("discard drops what is left, for a board that is being deleted", async () => {
    const { saver, read, panel } = await setup();
    const revision = panel.host.documents.get(ID)!.revision;
    saver.change(scene([rectangle()]));
    saver.discard();
    await saver.flush();
    await wait();
    expect(panel.host.documents.get(ID)!.revision).toBe(revision);
    expect(read()?.elements).toEqual([]);
  });
});
