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
