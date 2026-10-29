// The official Whiteboard module: boards, drawing, saving, and Undo for a deleted board.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { inModule, launch, openModule, panels, setContentSize, shootPanels, waitForShown, WHITEBOARD } from "./harness";

const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;
// The shared kit shows notices and the Undo offer as toasts, newest last; a dismissed one fades out for a moment.
const NEWEST_TOAST = `[...document.querySelectorAll('.tavora-toast-slot:not(.tavora-toast-leave-active) [data-slot="toast"]')].at(-1)`;
const DISMISS_TOASTS = `document.querySelectorAll('[data-slot="toast"] button[title="Dismiss"]').forEach((button) => button.click())`;
const UNDO_BUTTON = `[...document.querySelectorAll('[data-slot="toast"] button')].find((button) => button.textContent.trim() === "Undo")`;

async function drawingArea(app: ElectronApplication) {
  const rect = `(() => { const r=document.querySelector('.excalidraw canvas.interactive')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; })()`;
  await expect.poll(async () => { const area=await inModule<{width:number;height:number}|null>(app,WHITEBOARD,rect); return !!area && area.width>0 && area.height>0; }).toBe(true);
  await inModule(app,WHITEBOARD,`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  return (await inModule<{x:number;y:number;width:number;height:number}>(app,WHITEBOARD,rect));
}

async function newBoard(app: ElectronApplication, kind: "blank" | "idea" | "screenshot") {
  await expect.poll(() => inModule(app, WHITEBOARD, `!!${q("board-list")}`)).toBe(false);
  await click(app, "board-menu");
  await click(app, "board-new");
  await expect.poll(() => inModule(app, WHITEBOARD, `!!${q(`board-new-${kind}`)}`)).toBe(true);
  await inModule(app, WHITEBOARD, `${q(`board-new-${kind}`)}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `!!${q("board-list")}`)).toBe(false);
}

/** Runs a mouse gesture in the module's page as real input, the way a user draws. */
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
  const box = await drawingArea(app);
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-rectangle"]').click()`);
  await expect.poll(() => inModule(app,WHITEBOARD,`document.querySelector('[data-testid="toolbar-rectangle"]').checked`)).toBe(true);
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
  await newBoard(app, "blank");
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
interface DrawingElement {
  id: string;
  type: string;
  locked?: boolean;
  fileId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
}

async function storedBoard(userData: string, name: string): Promise<{ elements: DrawingElement[]; grid: boolean; files: Record<string, { blobId: string; mimeType: string }> } | undefined> {
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
  await newBoard(app, "blank");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 2");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("picture-lock")} === null`)).toBe(true);
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await inModule(app, WHITEBOARD, `document.querySelector('[data-testid^="board-board-"]').click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}?.textContent ?? ""`)).toBe("Board 1");
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("board")}.dataset.pictures`), { timeout: 15_000 }).toBe("1");

  // The user can unlock the pictures to move them, and lock them again.
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

/** A real click on an element of the module's page, so the host counts it as the user's. */
async function click(app: ElectronApplication, testId: string) {
  await expect.poll(() => inModule(app, WHITEBOARD, `(() => { const r=${q(testId)}?.getBoundingClientRect(); return !!r && r.width>0 && r.height>0; })()`)).toBe(true);
  // Module views use Electron input, so allow Vue/Popper to finish positioning a newly opened menu first.
  await inModule(app, WHITEBOARD, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
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
  // here the user takes what it suggests. Closing the dialog saves nothing.
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

  // Clear board sits in the board menu, not in the top bar next to the save actions. It takes everything off; Undo in
  // the notice brings it back.
  await inModule(app, WHITEBOARD, `${DISMISS_TOASTS}`);
  expect(await inModule(app, WHITEBOARD, `${q("clear-board")} === null`)).toBe(true);
  await inModule(app, WHITEBOARD, `${q("board-menu")}.click()`);
  await expect.poll(() => inModule(app, WHITEBOARD, `${q("clear-board")} !== null`)).toBe(true);
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
  await newBoard(app, "blank");
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
  await expect.poll(() => inModule(app, WHITEBOARD, `document.elementFromPoint(${Math.round(at.x)},${Math.round(at.y)})?.tagName`)).toBe("CANVAS");
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
  await expect.poll(() => inModule(app, WHITEBOARD, `(() => { const r=document.querySelector('.excalidraw canvas.interactive').getBoundingClientRect(); return r.width>0 && r.height>0; })()`)).toBe(true);
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
  await newBoard(app, "blank");
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

test("the hint for moving around the board is in Tavora's words", async () => {
  const { app, page } = await launch();
  try {
    await openModule(page, WHITEBOARD);
    await waitForShown(app, WHITEBOARD);
    await expect
      .poll(() => inModule(app, WHITEBOARD, `document.querySelector(".HintViewer")?.textContent.trim() ?? ""`))
      .toBe("Hold Space or the mouse wheel and drag to move around");
  } finally {
    await app.close();
  }
});

test("cards move as groups, undo, keep their pictures, and leave room in narrow panels", async () => {
  const { app, page, userData } = await launch();
  let closed = false;
  try {
    await openModule(page, WHITEBOARD);
    await waitForShown(app, WHITEBOARD);
    await expect.poll(() => inModule(app, WHITEBOARD, `!!document.querySelector('.excalidraw canvas.interactive')`)).toBe(true);
    await click(app, "add-card");
    await click(app, "add-note-card");
    const scene = async () => (await storedBoard(userData, "Board 1"))?.elements as unknown as { id: string; type: string; x: number; y: number; width: number; height: number; groupIds: string[]; locked: boolean }[] | undefined;
    await expect.poll(async () => (await scene())?.length).toBe(3);
    const note = (await scene())!;
    expect(new Set(note.flatMap((element) => element.groupIds)).size).toBe(1);
    const canvas = await inModule<{ x: number; y: number; width: number; height: number }>(app, WHITEBOARD, `(() => { const r=document.querySelector('.excalidraw canvas.interactive').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const from = { x: canvas.x + note[0]!.x + 140, y: canvas.y + note[0]!.y + 160 };
    await drag(app, from, { x: from.x - 180, y: from.y - 80 });
    await expect.poll(async () => (await scene())?.[0]?.x).toBeCloseTo(note[0]!.x - 180, 0);
    for (const [index, element] of (await scene())!.entries()) {
      expect(element.x).toBeCloseTo(note[index]!.x - 180, 0);
      expect(element.y).toBeCloseTo(note[index]!.y - 80, 0);
    }
    await app.evaluate(({webContents}, id) => {
      const target = webContents.getAllWebContents().find((view) => view.getURL().startsWith(`tavora-module://${id}/`))!;
      target.sendInputEvent({type: "keyDown", keyCode: "Z", modifiers: ["control"]});
      target.sendInputEvent({type: "keyUp", keyCode: "Z", modifiers: ["control"]});
    }, WHITEBOARD);
    await expect.poll(async () => (await scene())?.[0]?.x).toBeCloseTo(note[0]!.x, 0);
    await drag(app, from, { x: from.x - 360, y: from.y - 80 });

    // A local image chosen for a picture card, delivered through the file input's normal change handler.
    await inModule(app, WHITEBOARD, `(async () => {
      const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#285a75';ctx.fillRect(0,0,400,200);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const data=new DataTransfer();data.items.add(new File([blob],'camp.png',{type:'image/png'}));
      const input=document.querySelector('[data-testid="card-file"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await expect.poll(async () => (await scene())?.length).toBe(6);
    const card = (await scene())!.slice(3);
    expect((Math.min(...card.map((element) => element.x)) + Math.max(...card.map((element) => element.x + element.width))) / 2).toBeCloseTo(canvas.width / 2, 0);
    expect((Math.min(...card.map((element) => element.y)) + Math.max(...card.map((element) => element.y + element.height))) / 2).toBeCloseTo(canvas.height / 2, 0);
    expect((await scene())!.filter((element) => element.type === "image")[0]!.locked).toBe(false);
    await expect.poll(async () => Object.keys((await storedBoard(userData, "Board 1"))?.files ?? {}).length).toBe(1);
    await click(app, "picture-lock");
    await expect.poll(async () => (await scene())!.slice(3).every((element) => element.locked)).toBe(true);
    // Neutral lock is hidden away from the image, but a keyboard user can reveal it.
    await drag(app, {x: 1100, y: 650}, {x: 1100, y: 650});
    await movePointer(app, {x: 1100, y: 650});
    await expect.poll(() => inModule(app, WHITEBOARD, `getComputedStyle(document.querySelector('[data-testid="picture-lock-one"]')).opacity`)).toBe("0");
    await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="picture-lock-one"]').focus()`);
    await app.evaluate(({webContents}, id) => {
      const target = webContents.getAllWebContents().find((view) => view.getURL().startsWith(`tavora-module://${id}/`))!;
      target.sendInputEvent({type: "keyDown", keyCode: "Tab", modifiers: ["shift"]});
      target.sendInputEvent({type: "keyUp", keyCode: "Tab", modifiers: ["shift"]});
      target.sendInputEvent({type: "keyDown", keyCode: "Tab"});
      target.sendInputEvent({type: "keyUp", keyCode: "Tab"});
    }, WHITEBOARD);
    await expect.poll(() => inModule(app, WHITEBOARD, `getComputedStyle(document.querySelector('[data-testid="picture-lock-one"]')).opacity`)).toBe("1");
    await click(app, "picture-lock-one");
    await expect.poll(async () => (await scene())!.slice(3).every((element) => !element.locked)).toBe(true);
    await setContentSize(app, 540, 620);
    await expect.poll(() => inModule(app, WHITEBOARD, `document.querySelector('[data-testid="board-actions"]').getBoundingClientRect().width > 0`)).toBe(true);
    expect(await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="copy-picture"]').getBoundingClientRect().width`)).toBe(0);
    expect(await inModule(app, WHITEBOARD, `document.querySelector('header').getBoundingClientRect().height`)).toBeLessThan(45);
    // Fit to the resized viewport, as a user can do with Shift+1.
    await drag(app, {x: 100, y: 200}, {x: 100, y: 200});
    await app.evaluate(({webContents}, id) => {
      const target = webContents.getAllWebContents().find((view) => view.getURL().startsWith(`tavora-module://${id}/`))!;
      target.sendInputEvent({type: "keyDown", keyCode: "!", modifiers: ["shift"]});
      target.sendInputEvent({type: "keyUp", keyCode: "!", modifiers: ["shift"]});
    }, WHITEBOARD);
    await shootPanels(app, WHITEBOARD, test.info().outputPath("cards-narrow.png"));
    await click(app, "board-actions");
    await click(app, "compact-copy-picture");
    await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.textContent ?? ''`)).toContain("Copied");
    await app.close(); closed = true;
    const again = await launch(userData);
    try {
      await expect.poll(() => inModule(again.app, WHITEBOARD, `document.querySelector('[data-testid="board"]').dataset.pictures`).catch(() => "")).toBe("1");
      expect((await scene())!).toHaveLength(6);
      await shootPanels(again.app, WHITEBOARD, test.info().outputPath("cards-restored.png"));
    } finally { await again.app.close(); }
  } finally { if (!closed) await app.close(); }
});

test("adding a card preserves earlier deletions in Undo history", async () => {
  const { app, page, userData } = await launch();
  try {
    await openModule(page, WHITEBOARD);
    await waitForShown(app, WHITEBOARD);
    const add = async () => { await click(app, "add-card"); await click(app, "add-note-card"); };
    const key = async (keyCode: string, modifiers: ("control" | "shift")[] = []) => {
      await inModule(app, WHITEBOARD, `document.querySelector('.excalidraw').focus()`);
      await app.evaluate(({ webContents }, { id, keyCode, modifiers }) => {
        const target = webContents.getAllWebContents().find((view) => view.getURL().startsWith(`tavora-module://${id}/`))!;
        target.sendInputEvent({ type: "keyDown", keyCode, modifiers });
        target.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      }, { id: WHITEBOARD, keyCode, modifiers });
    };
    await expect.poll(() => inModule(app, WHITEBOARD, `document.querySelector('[data-testid="add-card"]').disabled`)).toBe(false);
    await add();
    await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.length).toBe(3);
    const original = (await storedBoard(userData, "Board 1"))!.elements.map((element) => element.id);
    await key("Delete");
    await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.length).toBe(0);
    await add();
    await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.length).toBe(3);
    await key("Z", ["control"]);
    await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.length).toBe(0);
    await key("Z", ["control"]);
    await expect.poll(async () => (await storedBoard(userData, "Board 1"))?.elements.map((element) => element.id)).toEqual(original);
  } finally { await app.close(); }
});

test("a broken picture card reports a localized error without changing the board", async () => {
  const { app, page, userData } = await launch(undefined, [], { locale: "de" });
  try {
    await openModule(page, WHITEBOARD);
    await waitForShown(app, WHITEBOARD);
    await expect.poll(() => inModule(app, WHITEBOARD, `document.querySelector('[data-testid="add-card"]').disabled`)).toBe(false);
    await inModule(app, WHITEBOARD, `(() => {
      const data=new DataTransfer();data.items.add(new File(['broken'],'camp.png',{type:'image/png'}));
      const input=document.querySelector('[data-testid="card-file"]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await expect.poll(() => inModule(app, WHITEBOARD, `${NEWEST_TOAST}?.textContent ?? ''`)).toContain("Dieses Bild konnte nicht gelesen werden.");
    expect(Object.values(await storedBoards(userData)).flat()).toEqual([]);
  } finally { await app.close(); }
});

test("connector modes bind to cards, follow a moved card and edit arrowheads", async () => {
  const { app, page, userData } = await launch();
  try {
    await openModule(page, WHITEBOARD);
    await expect.poll(() => inModule(app, WHITEBOARD, `${q("add-card")}.disabled`).catch(() => true)).toBe(false);
    const addNote = async () => { await click(app, "add-card"); await click(app, "add-note-card"); };
    const scene = async () => (await storedBoard(userData, "Board 1"))?.elements ?? [];
    await addNote();
    await expect.poll(async () => (await scene()).length).toBe(3);
    const first = (await scene())[0]!;
    const offset = await inModule<{x: number; y: number}>(app, WHITEBOARD, `(() => {const r=document.querySelector('.excalidraw canvas.interactive').getBoundingClientRect();return {x:r.x,y:r.y};})()`);
    await drag(app, {x:offset.x+first.x+200,y:offset.y+first.y+150}, {x:offset.x+first.x-180,y:offset.y+first.y+150});
    await expect.poll(async () => (await scene())[0]?.x).toBeCloseTo(first.x-380, 0);
    await addNote();
    await expect.poll(async () => (await scene()).length).toBe(6);
    const [left, right] = (await scene()).filter((element) => element.type === "rectangle");
    await click(app, "connector-menu");
    await click(app, "connector-line");
    await expect.poll(() => inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-arrow"]')?.checked ?? false`)).toBe(true);
    await drag(app, {x:offset.x+left!.x+left!.width+4,y:offset.y+left!.y+90}, {x:offset.x+right!.x-4,y:offset.y+right!.y+90});
    const arrow = async () => (await scene()).find((element) => element.type === "arrow");
    await expect.poll(async () => !!(await arrow())).toBe(true);
    await expect.poll(async () => (await arrow())?.startBinding?.elementId).toBe(left!.id);
    await expect.poll(async () => (await arrow())?.endBinding?.elementId).toBe(right!.id);
    expect((await arrow())!.startArrowhead).toBeNull();
    expect((await arrow())!.endArrowhead).toBeNull();
    await click(app, "connector-menu"); await click(app, "connector-two-way");
    await expect.poll(async () => (await arrow())?.startArrowhead).toBe("arrow");
    expect((await arrow())!.endArrowhead).toBe("arrow");
    await click(app, "connector-menu"); await click(app, "connector-one-way");
    await expect.poll(async () => (await arrow())?.startArrowhead).toBeNull();
    expect((await arrow())!.endArrowhead).toBe("arrow");
    const before = (await arrow())!;
    await inModule(app, WHITEBOARD, `document.querySelector('[data-testid="toolbar-selection"]').click()`);
    await drag(app, {x:offset.x+left!.x+200,y:offset.y+left!.y+150}, {x:offset.x+left!.x+160,y:offset.y+left!.y+105});
    await expect.poll(async () => (await scene()).find((element) => element.id===left!.id)?.x).toBeCloseTo(left!.x-40,0);
    await expect.poll(async () => {const current=(await arrow())!;return current.x!==before.x||current.y!==before.y;}).toBe(true);
    expect((await arrow())!.startBinding?.elementId).toBe(left!.id);
    expect((await arrow())!.endBinding?.elementId).toBe(right!.id);
    await shootPanels(app, WHITEBOARD, test.info().outputPath("connected-cards.png"));
  } finally { await app.close(); }
});

test("idea starters keep the original board and remember the grid per board after restart", async () => {
  const { app, page, userData } = await launch();
  let closed = false;
  try {
    await openModule(page, WHITEBOARD);
    await expect.poll(() => inModule(app, WHITEBOARD, `${q("add-card")}.disabled`).catch(() => true)).toBe(false);
    await newBoard(app, "idea");
    await expect.poll(() => inModule(app, WHITEBOARD, `${q("board-name")}.textContent`)).toBe("Idea board");
    const board = await storedBoard(userData, "Idea board");
    expect(board!.elements).toHaveLength(11);
    expect(board!.elements.filter((element) => element.type==="arrow").every((arrow) => arrow.startBinding && arrow.endBinding)).toBe(true);
    expect(board!.grid).toBe(false);
    expect((await storedBoard(userData,"Board 1"))!.elements).toEqual([]);
    await click(app,"board-menu"); await click(app,"board-grid");
    await newBoard(app,"blank");
    await expect.poll(() => inModule(app,WHITEBOARD,`${q("board-name")}.textContent`)).toBe("Board 3");
    expect((await storedBoard(userData,"Board 3"))!.grid).toBe(false);
    await expect.poll(async () => (await storedBoard(userData,"Idea board"))?.grid).toBe(true);
    await click(app,"board-menu");
    await inModule(app,WHITEBOARD,`[...document.querySelectorAll('[data-testid^="board-board-"]')].find(item=>item.textContent.includes('Idea board')).click()`);
    await expect.poll(() => inModule(app,WHITEBOARD,`${q("board-name")}.textContent`)).toBe("Idea board");
    await shootPanels(app,WHITEBOARD,test.info().outputPath("idea-grid.png"));
    await app.close();closed=true;
    const again=await launch(userData);
    try {
      await expect.poll(() => inModule(again.app,WHITEBOARD,`${q("board-name")}?.textContent`).catch(()=>"")).toBe("Idea board");
      await expect.poll(() => inModule(again.app,WHITEBOARD,`${q("add-card")}.disabled`)).toBe(false);
      await click(again.app,"board-menu");
      expect(await inModule(again.app,WHITEBOARD,`${q("board-grid")}.getAttribute('aria-checked')`)).toBe("true");
      await inModule(again.app,WHITEBOARD,`${q("board-menu")}.click()`);
      await expect.poll(() => inModule(again.app,WHITEBOARD,`!!${q("board-list")}`)).toBe(false);
      await shootPanels(again.app,WHITEBOARD,test.info().outputPath("idea-restored.png"));
    } finally {await again.app.close();}
  } finally {if(!closed) await app.close();}
});

test("screenshot starter cancellation creates nothing, then a chosen image is locked and kept", async () => {
  const { app, page, userData } = await launch();
  let closed=false;
  try {
    await openModule(page,WHITEBOARD);
    await expect.poll(() => inModule(app,WHITEBOARD,`${q("add-card")}.disabled`).catch(()=>true)).toBe(false);
    // Cancel the native chooser without opening an OS dialog in the test run.
    await inModule(app,WHITEBOARD,`${q("starter-file")}.addEventListener('click',event=>event.preventDefault(),{once:true})`);
    await newBoard(app,"screenshot");
    expect(Object.keys(await storedBoards(userData))).toEqual(["Board 1"]);
    await inModule(app,WHITEBOARD,`(() => {const files=new DataTransfer();files.items.add(new File(['broken'],'bad.png',{type:'image/png'}));${q("starter-file")}.files=files.files;${q("starter-file")}.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await expect.poll(() => inModule(app,WHITEBOARD,`${NEWEST_TOAST}?.textContent ?? ''`)).toContain("Could not create the board");
    expect(Object.keys(await storedBoards(userData))).toEqual(["Board 1"]);
    await inModule(app,WHITEBOARD,`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#285a75';ctx.fillRect(0,0,1600,900);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const files=new DataTransfer();files.items.add(new File([blob],'map.png',{type:'image/png'}));
      ${q("starter-file")}.files=files.files;${q("starter-file")}.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await expect.poll(() => inModule(app,WHITEBOARD,`${q("board-name")}.textContent`)).toBe("Screenshot annotation");
    await expect.poll(() => inModule(app,WHITEBOARD,`${q("board")}.dataset.pictures`)).toBe("1");
    const board=(await storedBoard(userData,"Screenshot annotation"))!;
    expect(board.elements).toHaveLength(1);
    expect(board.elements[0]!.locked).toBe(true);
    expect(board.elements[0]!.width).toBe(1440);
    expect(Object.keys(board.files)).toHaveLength(1);
    expect((await storedBoard(userData,"Board 1"))!.elements).toEqual([]);
    await shootPanels(app,WHITEBOARD,test.info().outputPath("screenshot-starter.png"));
    await app.close();closed=true;
    const again=await launch(userData);
    try {
      await expect.poll(() => inModule(again.app,WHITEBOARD,`${q("board")}.dataset.pictures`).catch(()=>"")).toBe("1");
    }
    finally {await again.app.close();}
  } finally {if(!closed)await app.close();}
});
