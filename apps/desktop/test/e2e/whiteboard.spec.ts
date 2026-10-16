// The official Whiteboard module: boards, drawing, saving, and Undo for a deleted board.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { inModule, launch, openModule, panels, WHITEBOARD } from "./harness";

const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;

/** Runs a mouse gesture in the module's page as real input, the way a player draws. */
async function drag(app: ElectronApplication, from: { x: number; y: number }, to: { x: number; y: number }) {
  await app.evaluate(
    async ({ webContents }, { moduleId, from, to }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      const at = (point: { x: number; y: number }) => ({ x: Math.round(point.x), y: Math.round(point.y), button: "left" as const, clickCount: 1 });
      target.sendInputEvent({ type: "mouseMove", ...at(from) });
      target.sendInputEvent({ type: "mouseDown", ...at(from) });
      for (let step = 1; step <= 8; step++) {
        target.sendInputEvent({ type: "mouseMove", ...at({ x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 }) });
      }
      target.sendInputEvent({ type: "mouseUp", ...at(to) });
    },
    { moduleId: WHITEBOARD, from, to },
  );
}

/** Moves the pointer over the page, so Excalidraw knows where a paste goes. */
async function movePointer(app: ElectronApplication, to: { x: number; y: number }) {
  await app.evaluate(
    async ({ webContents }, { moduleId, to }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      target.sendInputEvent({ type: "mouseMove", x: Math.round(to.x), y: Math.round(to.y) });
    },
    { moduleId: WHITEBOARD, to },
  );
}

/** The elements stored in every board document, by board name. */
async function storedBoards(userData: string): Promise<Record<string, { type: string }[]>> {
  const files = (await readdir(path.join(userData, "module-data", WHITEBOARD), { recursive: true })).filter((name) => /board-[a-z0-9-]+\.json$/.test(name));
  const boards: Record<string, { type: string }[]> = {};
  for (const file of files) {
    const document = JSON.parse(await readFile(path.join(userData, "module-data", WHITEBOARD, file), "utf8")) as { title?: string; data?: { elements?: { type: string }[] } };
    boards[document.title ?? file] = document.data?.elements ?? [];
  }
  return boards;
}

test("whiteboard: draw on a board, keep it, switch boards, delete one and bring it back", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, WHITEBOARD);
  await expect(panels(page, WHITEBOARD)).toHaveCount(1);

  // A first board exists and Excalidraw has loaded (offline, with its fonts from the module's own folder).
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);

  // Draw a rectangle with the toolbar's tool.
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  const box = await inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  await drag(app, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 }, { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 });
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("save-state")}.dataset.state`), { timeout: 10_000 }).toBe("saved");
  await expect.poll(async () => (await storedBoards(userData))["Board 1"]?.map((element) => element.type)).toEqual(["rectangle"]);

  // A second board starts empty; the first keeps its drawing.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-new")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 2");
  expect((await storedBoards(userData))["Board 2"]).toEqual([]);
  expect((await storedBoards(userData))["Board 1"]).toHaveLength(1);

  // Rename the current board.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-rename")}.click()`);
  await inModule(
    app,
    WHITEBOARD,
    `(() => { const input = ${q("board-rename-input")}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Atlas map"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`,
  );
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Atlas map");
  await expect.poll(async () => Object.keys(await storedBoards(userData)).sort()).toEqual(["Atlas map", "Board 1"]);

  // Deleting shows an Undo notice and Board 1 is shown; Undo brings the board back.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-delete")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("undo-toast")}?.innerText ?? ""`)).toContain("Atlas map");
  await expect.poll(async () => Object.keys(await storedBoards(userData))).toEqual(["Board 1"]);
  await inModule(app, WHITEBOARD, `${q("undo")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Atlas map");
  await expect.poll(async () => Object.keys(await storedBoards(userData)).sort()).toEqual(["Atlas map", "Board 1"]);
  await app.close();
});

/** The data stored for the board with this name. */
async function storedBoard(userData: string, name: string): Promise<{ elements: { type: string; locked?: boolean; fileId?: string }[]; files: Record<string, { blobId: string; mimeType: string }> } | undefined> {
  const root = path.join(userData, "module-data", WHITEBOARD);
  for (const file of (await readdir(root, { recursive: true })).filter((entry) => /board-[a-z0-9-]+\.json$/.test(entry))) {
    const document = JSON.parse(await readFile(path.join(root, file), "utf8")) as { title?: string; data?: never };
    if (document.title === name) return document.data;
  }
  return undefined;
}

test("whiteboard: a pasted picture is kept in the file store, locked, and comes back with the board", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, WHITEBOARD);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);

  // Paste a screenshot over the board, the way Ctrl+V does.
  const area = await inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  await movePointer(app, { x: area.x + area.width / 2, y: area.y + area.height / 2 });
  await inModule(
    app,
    WHITEBOARD,
    `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 200;
      const context = canvas.getContext("2d");
      context.fillStyle = "#08c";
      context.fillRect(0, 0, 400, 200);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "shot.png", { type: "image/png" }));
      document.querySelector(".excalidraw").focus();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`,
  );
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`), { timeout: 15_000 }).toBe("true");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("save-state")}.dataset.state`), { timeout: 15_000 }).toBe("saved");

  // The picture's pixels arrive a moment after its element, and that is saved too.
  await expect.poll(async () => Object.keys((await storedBoard(userData, "Board 1"))?.files ?? {}).length, { timeout: 15_000 }).toBe(1);
  // The board holds a locked picture and the id of a file in the file store; the pixels are not in the board.
  const board = (await storedBoard(userData, "Board 1"))!;
  const picture = board.elements.find((element) => element.type === "image")!;
  expect(picture.locked).toBe(true);
  const stored = board.files[picture.fileId!]!;
  expect(stored.blobId).toMatch(/^[a-f0-9]{32}$/);
  const folder = path.join(userData, "module-blobs", WHITEBOARD);
  const files = (await readdir(folder, { recursive: true })).map((name) => path.basename(name));
  expect(files).toContain(`${stored.blobId}.png`);
  expect(JSON.stringify(board)).not.toContain("data:image");

  // Another board and back: the picture is read from the file store again.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-new")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 2");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")} === null`)).toBe(true);
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid^="board-board-"]').click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board")}.dataset.pictures`), { timeout: 15_000 }).toBe("1");

  // The player can unlock the pictures to move them, and lock them again.
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`)).toBe("true");
  await inModule(app, WHITEBOARD, `${q("picture-lock")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}.dataset.locked`)).toBe("false");
  await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.find((element) => element.type === "image")?.locked).toBe(false);
  await app.close();
});
