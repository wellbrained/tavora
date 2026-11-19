// @vitest-environment jsdom
import { openDocument } from "@tavora/sdk/store";
import { createMemoryHost } from "@tavora/sdk/testing";
import type { JsonValue } from "@tavora/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardTitle, emptyBoard, parseBoard, type BoardData } from "./boards";
import { createBoardSession } from "./boardSession";

const exportToBlob = vi.hoisted(() => vi.fn(async (_: { elements: { id: string }[]; files: Record<string, unknown> }) => new Blob(["png"], { type: "image/png" })));
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob,
  getCommonBounds: () => [0, 0, 0, 0],
  convertToExcalidrawElements: (elements: unknown[]) => elements,
  CaptureUpdateAction: { IMMEDIATELY: "IMMEDIATELY", NEVER: "NEVER", EVENTUALLY: "EVENTUALLY" },
}));

const ID = "board-000000001-aaaa";

/** A board with a locked, pasted picture and a rectangle drawn over it that is still selected, as right after drawing it. */
async function setup(stored: Partial<BoardData> = {}) {
  const { host, sdk } = createMemoryHost();
  host.documents.put({ id: ID, title: "Atlas", data: { ...emptyBoard(), name: "Atlas", ...stored } as unknown as JsonValue });
  const document = await openDocument(sdk, ID, { parse: (raw) => parseBoard(raw), title: boardTitle, merge: "mine", debounceMs: 0 });
  const session = createBoardSession({ sdk, document, isDark: () => true });
  const scene = [
    { id: "picture", type: "image", fileId: "file-1", locked: true, isDeleted: false, groupIds: [] },
    { id: "box", type: "rectangle", locked: false, isDeleted: false, groupIds: [] },
    { id: "gone", type: "rectangle", locked: false, isDeleted: true, groupIds: [] },
  ];
  const files = { "file-1": { id: "file-1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 } };
  const api = {
    getAppState: () => ({ selectedElementIds: { box: true }, viewBackgroundColor: "#121212" }),
    getSceneElements: () => scene.filter((element) => !element.isDeleted),
    getFiles: () => files,
    addFiles: vi.fn(),
  };
  session.ready(api as never);
  const writeImage = vi.spyOn(sdk.clipboard, "writeImage").mockResolvedValue(undefined as never);
  const save = vi.spyOn(sdk.pictures, "save").mockResolvedValue({ fileName: "Atlas.png" } as never);
  return { session, api, writeImage, save };
}

afterEach(() => {
  exportToBlob.mockClear();
  vi.unstubAllGlobals();
});

describe("Copy and Save as image", () => {
  it("copies the whole board with its picture, even when only a shape over it is selected", async () => {
    const { session, writeImage } = await setup();
    await session.copyAsPicture();
    const [options] = exportToBlob.mock.calls[0]!;
    expect(options.elements.map((element) => element.id)).toEqual(["picture", "box"]);
    expect(Object.keys(options.files)).toEqual(["file-1"]);
    expect(writeImage).toHaveBeenCalledTimes(1);
    await session.dispose();
  });

  it("saves the same whole-board picture", async () => {
    const { session, save } = await setup();
    expect(await session.saveAsPicture("Atlas")).toEqual({ fileName: "Atlas.png" });
    expect(exportToBlob.mock.calls[0]![0].elements.map((element) => element.id)).toEqual(["picture", "box"]);
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "Atlas");
    await session.dispose();
  });

  it("waits for the board's stored pictures before making the picture", async () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    const { session, api } = await setup({
      elements: [{ id: "picture", type: "image", fileId: "file-1", isDeleted: false }] as never,
      files: { "file-1": { blobId: "a".repeat(32), mimeType: "image/png", created: 1 } },
    });
    const copied = session.copyAsPicture();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exportToBlob).not.toHaveBeenCalled();
    answer(new Response("png", { headers: { "content-type": "image/png" } }));
    await copied;
    expect(api.addFiles).toHaveBeenCalledTimes(1);
    expect(api.addFiles.mock.invocationCallOrder[0]!).toBeLessThan(exportToBlob.mock.invocationCallOrder[0]!);
    await session.dispose();
  });
});
