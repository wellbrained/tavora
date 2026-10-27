// The official Whiteboard module: boards, drawing, saving, and Undo for a deleted board.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { inModule, launch, openModule, panels, shootPanels, WHITEBOARD } from "./harness";

const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;
// The shared kit shows notices and the Undo offer as toasts, newest last.
const NEWEST_TOAST = `[...document.querySelectorAll('[data-slot="toast"]')].at(-1)`;
const DISMISS_TOASTS = `document.querySelectorAll('[data-slot="toast"] button[title="Dismiss"]').forEach((button) => button.click())`;
const UNDO_BUTTON = `[...document.querySelectorAll('[data-slot="toast"] button')].find((button) => button.textContent.trim() === "Undo")`;

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
  const files = (await readdir(path.join(userData, "module-data", "official", WHITEBOARD), { recursive: true })).filter((name) => /board-[a-z0-9-]+\.json$/.test(name));
  const boards: Record<string, { type: string }[]> = {};
  for (const file of files) {
    const document = JSON.parse(await readFile(path.join(userData, "module-data", "official", WHITEBOARD, file), "utf8")) as { title?: string; data?: { elements?: { type: string }[] } };
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
  const savePosition = await inModule<{ inHeader: boolean; inFooter: boolean; gap: number; centerOffset: number }>(app, WHITEBOARD, `(() => {
    const status = ${q("save-state")};
    const statusBox = status.getBoundingClientRect();
    const helpBox = document.querySelector(".excalidraw .help-icon").getBoundingClientRect();
    return {
      inHeader: !!status.closest("header.bar"),
      inFooter: !!status.closest("footer"),
      gap: helpBox.left - statusBox.right,
      centerOffset: Math.abs((statusBox.top + statusBox.bottom - helpBox.top - helpBox.bottom) / 2),
    };
  })()`);
  expect(savePosition.inHeader).toBe(false);
  expect(savePosition.inFooter).toBe(true);
  expect(savePosition.gap).toBeGreaterThanOrEqual(0);
  expect(savePosition.gap).toBeLessThan(20);
  expect(savePosition.centerOffset).toBeLessThan(2);
  await shootPanels(app, WHITEBOARD, test.info().outputPath("save-status.png"));
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
  await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.innerText ?? ""`)).toContain("Atlas map");
  await expect.poll(async () => Object.keys(await storedBoards(userData))).toEqual(["Board 1"]);
  await inModule(app, WHITEBOARD, `${UNDO_BUTTON}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Atlas map");
  await expect.poll(async () => Object.keys(await storedBoards(userData)).sort()).toEqual(["Atlas map", "Board 1"]);
  await app.close();
});

/** The data stored for the board with this name. */
async function storedBoard(userData: string, name: string): Promise<{ elements: { type: string; locked?: boolean; fileId?: string }[]; files: Record<string, { blobId: string; mimeType: string }> } | undefined> {
  const root = path.join(userData, "module-data", "official", WHITEBOARD);
  for (const file of (await readdir(root, { recursive: true })).filter((entry) => /board-[a-z0-9-]+\.json$/.test(entry))) {
    const document = JSON.parse(await readFile(path.join(root, file), "utf8")) as { title?: string; data?: never };
    if (document.title === name) return document.data;
  }
  return undefined;
}

test("whiteboard: a pasted picture can be dragged into place, is then locked, kept in the file store, and comes back with the board", async () => {
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
  // The new picture stays free while it is selected, so it can be dragged into place.
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`), { timeout: 15_000 }).toBe("false");
  await expect.poll(async () => Object.keys((await storedBoard(userData, "Board 1"))?.files ?? {}).length, { timeout: 15_000 }).toBe(1);
  const before = (await storedBoard(userData, "Board 1"))!.elements.find((element) => element.type === "image") as unknown as { x: number; y: number };
  const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  await drag(app, middle, { x: middle.x - 80, y: middle.y + 40 });
  await expect.poll(async () => ((await storedBoard(userData, "Board 1"))?.elements.find((element) => element.type === "image") as unknown as { x: number } | undefined)?.x, { timeout: 15_000 }).toBeLessThan(before.x - 40);
  const moved = (await storedBoard(userData, "Board 1"))!.elements.find((element) => element.type === "image") as unknown as { x: number; y: number };
  expect(moved.y).toBeGreaterThan(before.y + 20);
  // Letting go of it (a click on an empty spot above it) locks it.
  const empty = { x: middle.x + 150, y: middle.y - 120 };
  await drag(app, empty, empty);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`), { timeout: 15_000 }).toBe("true");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("save-state")}.dataset.state`), { timeout: 15_000 }).toBe("saved");

  // The picture's pixels arrive a moment after its element, and that is saved too.
  await expect.poll(async () => Object.keys((await storedBoard(userData, "Board 1"))?.files ?? {}).length, { timeout: 15_000 }).toBe(1);
  // The board holds a locked picture and the id of a file in the file store; the pixels are not in the board.
  await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.find((element) => element.type === "image")?.locked, { timeout: 15_000 }).toBe(true);
  const board = (await storedBoard(userData, "Board 1"))!;
  const picture = board.elements.find((element) => element.type === "image")!;
  expect(picture.locked).toBe(true);
  const stored = board.files[picture.fileId!]!;
  expect(stored.blobId).toMatch(/^[a-f0-9]{32}$/);
  const folder = path.join(userData, "module-blobs", "official", WHITEBOARD);
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

  // Each picture has its own lock on its corner, which locks and unlocks just that one.
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock-one")}?.dataset.locked ?? ""`)).toBe("false");
  await click(app, "picture-lock-one");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock-one")}?.dataset.locked ?? ""`)).toBe("true");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}.dataset.locked`)).toBe("true");
  await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.find((element) => element.type === "image")?.locked).toBe(true);
  await click(app, "picture-lock-one");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock-one")}?.dataset.locked ?? ""`)).toBe("false");
  await app.close();
});

/** A real click on an element of the module's page, so the host counts it as the player's. */
async function click(app: ElectronApplication, testId: string) {
  const box = await inModule<{ x: number; y: number }>(app, WHITEBOARD, `(() => { const r = ${q(testId)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await app.evaluate(
    async ({ webContents }, { moduleId, box }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      const at = { x: Math.round(box.x), y: Math.round(box.y), button: "left" as const, clickCount: 1 };
      target.sendInputEvent({ type: "mouseMove", ...at });
      target.sendInputEvent({ type: "mouseDown", ...at });
      target.sendInputEvent({ type: "mouseUp", ...at });
    },
    { moduleId: WHITEBOARD, box },
  );
}

test("whiteboard: Copy and Save as picture, and Clear board with Undo", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, WHITEBOARD);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);

  // Nothing to copy on an empty board.
  expect(await inModule(app, WHITEBOARD, `${q("copy-picture")}.disabled`)).toBe(true);

  // A screenshot-sized picture (the largest Excalidraw keeps) with a rectangle drawn over it.
  const area = await inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  await movePointer(app, { x: area.x + area.width / 2, y: area.y + area.height / 2 });
  await inModule(
    app,
    WHITEBOARD,
    `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 900;
      const context = canvas.getContext("2d");
      for (let y = 0; y < 900; y += 30) for (let x = 0; x < 1440; x += 40) { context.fillStyle = "hsl(" + ((x + y) % 360) + " 60% 50%)"; context.fillRect(x, y, 38, 28); }
      context.fillStyle = "#fff";
      context.font = "24px sans-serif";
      for (let y = 40; y < 900; y += 60) context.fillText("A screenshot with some text in it " + y, 20, y);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "shot.png", { type: "image/png" }));
      document.querySelector(".excalidraw").focus();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`,
  );
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`), { timeout: 15_000 }).toBe("false");
  // Picking a tool lets go of the picture, which locks it.
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")}?.dataset.locked ?? ""`), { timeout: 15_000 }).toBe("true");
  await drag(app, { x: area.x + 60, y: area.y + 60 }, { x: area.x + 260, y: area.y + 200 });
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("copy-picture")}.disabled`)).toBe(false);

  /** Copies with a real click and returns the notice and the size of the picture on the clipboard. */
  const copy = async () => {
    await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
    await app.evaluate(({ clipboard }) => clipboard.clear());
    const started = Date.now();
    await click(app, "copy-picture");
    await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.textContent ?? ""`), { timeout: 15_000 }).toContain("Copied");
    // The host takes the copy only within 2 s of the click, so making the picture must be quick.
    expect(Date.now() - started).toBeLessThan(2000);
    // The PNG's size from its header (width and height follow the signature and the header chunk's length and type).
    const size = await app.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find((entry) => entry.types.includes("image/png"));
      if (!item) return { width: 0, height: 0 };
      const header = new DataView(await (await item.getType("image/png")).arrayBuffer());
      return { width: header.getUint32(16), height: header.getUint32(20) };
    });
    return { notice: await inModule<string>(app, WHITEBOARD, `${NEWEST_TOAST}.textContent`), size };
  };

  // The rectangle just drawn is selected, so only it is copied, twice its size.
  const selection = await copy();
  expect(selection.notice).toContain("Copied the selection as an image");
  expect(selection.size.width).toBeGreaterThan(400);
  expect(selection.size.width).toBeLessThan(1000);

  // A click on the locked picture clears the selection; then the whole board is copied, sharper than the 1440 px picture.
  await drag(app, { x: area.x + area.width * 0.7, y: area.y + area.height * 0.6 }, { x: area.x + area.width * 0.7, y: area.y + area.height * 0.6 });
  const board = await copy();
  expect(board.notice).toContain("Copied the board as an image");
  expect(board.size.width).toBeGreaterThan(1440);
  expect(Math.max(board.size.width, board.size.height)).toBeLessThanOrEqual(8192);

  // Excalidraw's own shortcut for copying as PNG copies through Tavora too.
  await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await app.evaluate(
    async ({ webContents }, moduleId) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      target.sendInputEvent({ type: "keyDown", keyCode: "C", modifiers: ["shift", "alt"] });
      target.sendInputEvent({ type: "keyUp", keyCode: "C", modifiers: ["shift", "alt"] });
    },
    WHITEBOARD,
  );
  await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.textContent ?? ""`), { timeout: 15_000 }).toContain("Copied the board as an image");
  expect(await app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((item) => item.types))).toContain("image/png");

  // Save as picture opens the save dialog in Pictures\Tavora with the board's name filled in (numbered when taken);
  // here the player takes what it suggests. Closing the dialog saves nothing.
  await app.evaluate(({ dialog }) => {
    const state = globalThis as { saveAnswer?: "save" | "close"; savedIn?: string[] };
    state.saveAnswer = "close";
    state.savedIn = [];
    dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => {
      state.savedIn!.push(options.defaultPath ?? "");
      return state.saveAnswer === "close" ? { canceled: true, filePath: "" } : { canceled: false, filePath: options.defaultPath! };
    }) as unknown as typeof dialog.showSaveDialog;
  });
  await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
  await click(app, "save-picture");
  await expect.poll(() => app.evaluate(() => (globalThis as { savedIn?: string[] }).savedIn!.length)).toBe(1);
  expect(await app.evaluate(() => (globalThis as { savedIn?: string[] }).savedIn![0])).toMatch(/[\\/]Pictures[\\/]Tavora[\\/]Board 1 [^\\/]+\.png$/);
  await app.evaluate(() => void ((globalThis as { saveAnswer?: string }).saveAnswer = "save"));
  for (const expected of [/^Board 1 \d{4}-\d\d-\d\d \d\d-\d\d\.png$/, /^Board 1 \d{4}-\d\d-\d\d \d\d-\d\d( \(2\))?\.png$/]) {
    await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
    await click(app, "save-picture");
    await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.textContent ?? ""`), { timeout: 15_000 }).toContain("Saved the board as");
    const notice = await inModule<string>(app, WHITEBOARD, `${NEWEST_TOAST}.textContent`);
    expect(notice.match(/“(.+)”/)?.[1]).toMatch(expected);
  }
  const saved = await readdir(path.join(userData, "Pictures", "Tavora"));
  expect(saved).toHaveLength(2);
  const file = await readFile(path.join(userData, "Pictures", "Tavora", saved[0]!));
  expect([...file.subarray(1, 4)].map((byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
  // Without a click it is refused.
  const refused = await inModule<string>(app, WHITEBOARD, `fetch("/_pictures/?name=x", { method: "POST", body: new Blob([new Uint8Array(8)], { type: "image/png" }) }).then((r) => r.status)`);
  expect(refused).toBe(403);

  // Clear board takes everything off; Undo in the notice brings it back.
  await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
  await inModule(app, WHITEBOARD, `${q("clear-board")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("copy-picture")}.disabled`)).toBe(true);
  await inModule(app, WHITEBOARD, `${UNDO_BUTTON}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("copy-picture")}.disabled`)).toBe(false);
  expect(await inModule(app, WHITEBOARD, `${q("picture-lock")} !== null`)).toBe(true);
  await app.close();
});

test("whiteboard: the style palette can be moved and folded away, and stays so for the panel", async () => {
  const { app, page } = await launch();
  await openModule(page, WHITEBOARD);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);

  // The palette shows with a tool picked, with its handle on top.
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `!!${q("palette-handle")}`), { timeout: 10_000 }).toBe(true);
  const rect = (selector: string) => inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const start = await rect(".App-menu__left");
  const handle = await rect('[data-testid="palette-handle"]');
  const grab = { x: handle.x + 20, y: handle.y + handle.height / 2 };
  await drag(app, grab, { x: grab.x + 200, y: grab.y + 30 });
  await expect.poll(async () => Math.round((await rect(".App-menu__left")).x - start.x)).toBe(200);
  expect(Math.round((await rect(".App-menu__left")).y - start.y)).toBe(30);

  // Only the main options show; the stroke colour is called Color, and the rest waits under More options.
  const visible = (name: string) => inModule<boolean>(app, WHITEBOARD, `(() => { const input = document.querySelector('.App-menu__left input[name="${name}"]'); return !!input && input.closest("fieldset").offsetParent !== null; })()`);
  expect(await visible("strokeStyle")).toBe(true);
  expect(await visible("sloppiness")).toBe(false);
  expect(await inModule(app, WHITEBOARD, `document.querySelector(".App-menu__left .panelColumn h3")?.textContent ?? ""`)).toBe("Color");
  await inModule(app, WHITEBOARD, `${q("palette-more")}.click()`);
  await expect.poll(() => visible("sloppiness")).toBe(true);
  await inModule(app, WHITEBOARD, `${q("palette-more")}.click()`);
  await expect.poll(() => visible("sloppiness")).toBe(false);

  // Folded away, only the handle is left.
  await inModule(app, WHITEBOARD, `${q("palette-toggle")}.click()`);
  await expect.poll(async () => (await rect(".App-menu__left")).height).toBeLessThan(60);

  // Another board: the palette is where it was left, still folded.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-new")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 2");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `!!${q("palette-handle")}`), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => Math.round((await rect(".App-menu__left")).x - start.x)).toBe(200);
  expect((await rect(".App-menu__left")).height).toBeLessThan(60);
  await inModule(app, WHITEBOARD, `${q("palette-toggle")}.click()`);
  await expect.poll(async () => (await rect(".App-menu__left")).height).toBeGreaterThan(100);
  await app.close();
});

test("whiteboard: the toolbar can sit at the bottom, chosen once for every workspace", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, WHITEBOARD);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);
  const toolbarTop = () => inModule<number>(app, WHITEBOARD, `Math.round(document.querySelector(".App-toolbar-container").getBoundingClientRect().top - document.querySelector(".excalidraw").getBoundingClientRect().top)`);
  const height = await inModule<number>(app, WHITEBOARD, `document.querySelector(".excalidraw").getBoundingClientRect().height`);
  expect(await toolbarTop()).toBeLessThan(60);

  // The main menu moves it down, above the zoom and undo buttons.
  await inModule(app, WHITEBOARD, `document.querySelector(".main-menu-trigger").click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("toolbar-place")}?.textContent ?? ""`)).toContain("Toolbar at the bottom");
  await inModule(app, WHITEBOARD, `${q("toolbar-place")}.click()`);
  await expect.poll(toolbarTop).toBeGreaterThan(height - 160);

  // Kept: a new panel starts with it at the bottom.
  await app.close();
  const again = await launch(userData);
  await expect.poll(() => inModule(again.app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`).catch(() => false), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => inModule<number>(again.app, WHITEBOARD, `Math.round(document.querySelector(".App-toolbar-container").getBoundingClientRect().top - document.querySelector(".excalidraw").getBoundingClientRect().top)`)).toBeGreaterThan(height - 160);
  await again.app.close();
});

/** Zooms in with Ctrl and the mouse wheel (a touchpad pinch sends the same), over `at`. */
async function zoomIn(app: ElectronApplication, at: { x: number; y: number }, notches: number) {
  await app.evaluate(
    async ({ webContents }, { moduleId, at, notches }) => {
      const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
      if (!target) throw new Error("no panel");
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      target.sendInputEvent({ type: "mouseMove", x, y });
      for (let notch = 0; notch < notches; notch++) {
        target.sendInputEvent({ type: "mouseWheel", x, y, deltaX: 0, deltaY: 100, wheelTicksY: -1, canScroll: true, modifiers: ["control"] });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    },
    { moduleId: WHITEBOARD, at, notches },
  );
}

test("whiteboard: zoomed far in, a pasted picture keeps its size and an empty board opens at 100%", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, WHITEBOARD);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`).catch(() => ""), { timeout: 20_000 }).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);
  const area = await inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r = document.querySelector(".excalidraw canvas.interactive").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const middle = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const zoom = () => inModule<number>(app, WHITEBOARD, `parseInt(document.querySelector(".excalidraw .reset-zoom-button").textContent, 10)`);

  // Zoomed far in, the way a pinch or Ctrl and the wheel easily gets there.
  await zoomIn(app, middle, 25);
  await expect.poll(zoom).toBeGreaterThan(1000);

  // A pasted screenshot gets the size it gets at 100%, not one shrunk to the zoom: strokes drawn on it would be
  // twenty times too thick for it.
  await inModule(
    app,
    WHITEBOARD,
    `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      canvas.getContext("2d").fillRect(0, 0, 1600, 900);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "shot.png", { type: "image/png" }));
      document.querySelector(".excalidraw").focus();
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`,
  );
  const picture = async () => (await storedBoard(userData, "Board 1"))?.elements.find((element) => element.type === "image") as unknown as { height: number } | undefined;
  await expect.poll(async () => (await picture())?.height ?? 0, { timeout: 15_000 }).toBeCloseTo(Math.floor(area.height * 0.5), 0);

  // An empty board left zoomed far in opens at 100% again; one with a drawing comes back where it was left.
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `${q("board-new")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 2");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);
  await zoomIn(app, middle, 25);
  await expect.poll(zoom).toBeGreaterThan(1000);
  const open = async (name: string) => {
    await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
    await inModule(app, WHITEBOARD, `[...${q("board-list")}.querySelectorAll('[data-testid^="board-board-"]')].find((item) => item.textContent.includes(${JSON.stringify(name)})).click()`);
    await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe(name);
    await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector(".excalidraw canvas.interactive")`), { timeout: 20_000 }).toBe(true);
  };
  await open("Board 1");
  await expect.poll(zoom).toBeGreaterThan(1000);
  await open("Board 2");
  await expect.poll(zoom).toBe(100);
  await app.close();
});
