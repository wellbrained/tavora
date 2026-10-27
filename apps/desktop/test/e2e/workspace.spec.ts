import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  clickInModule,
  expectModuleText,
  inModule,
  launch,
  openWorkspace,
  openModule,
  panels,
  RAIL_WIDTH,
  REACT,
  setContentSize,
  VANILLA,
  waitForShown,
} from "./harness";

test("a new game starts with an empty workspace", async () => {
  const { app, page } = await launch();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await expect(panels(page)).toHaveCount(0);
  // Choosing a layout comes first: the card has no Add module button of its own.
  await expect(page.getByTestId("empty-add-module")).toHaveCount(0);
  await app.close();
});

test("a layout or a grid chosen on the empty workspace fills it with panes that each have Add module", async () => {
  const { app, page } = await launch();
  // The card must sit above the docking area, or the buttons on it cannot be clicked.
  await page.getByTestId("empty-template-main-stacked").click({ timeout: 3000 });
  const slots = page.locator("[data-testid^='empty-slot-']");
  await expect(slots).toHaveCount(3);
  await expect(page.getByTestId("empty-workspace")).toHaveCount(0);
  await slots.first().getByTestId("slot-add-module").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await app.close();

  const grid = await launch();
  await grid.page.getByTestId("layout-grid-3x2").click({ timeout: 3000 });
  await expect(grid.page.locator("[data-testid^='empty-slot-']")).toHaveCount(6);
  await grid.app.close();
});

test("React and vanilla modules load, get trusted workspace context and persist data", async () => {
  const { app, page, userData } = await launch();

  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expect(panels(page)).toHaveCount(2);

  for (const moduleId of [VANILLA, REACT]) {
    await expectModuleText(app, moduleId, "status", "Connected");
    await expectModuleText(app, moduleId, "workspace", "Path of Exile 2");
  }

  for (let i = 0; i < 3; i++) await clickInModule(app, VANILLA, "increment");
  await clickInModule(app, REACT, "increment");
  await expectModuleText(app, VANILLA, "count", "3");
  await expectModuleText(app, REACT, "count", "1");

  // Closing a panel removes the panel, never the module's data.
  await panels(page, VANILLA).getByTestId("close").click();
  await expect(panels(page)).toHaveCount(1);
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "count", "3");

  // Each game has its own workspace and its own module data.
  await openWorkspace(page, "satisfactory");
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "workspace", "Satisfactory");
  await expectModuleText(app, VANILLA, "count", "0");

  await openWorkspace(page, "poe2");
  await expect(panels(page)).toHaveCount(2);
  await expectModuleText(app, VANILLA, "count", "3");
  await expectModuleText(app, REACT, "count", "1");

  // Layout and data survive a restart.
  await app.close();
  const again = await launch(userData);
  await expect(panels(again.page)).toHaveCount(2);
  await expectModuleText(again.app, VANILLA, "count", "3");
  await expectModuleText(again.app, REACT, "count", "1");
  await again.app.close();
});

test("modules receive resize events matching their panel size", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, REACT);
  await expectModuleText(app, VANILLA, "status", "Connected");

  await setContentSize(app, RAIL_WIDTH + 1000, 700);
  // Two equal cards in 1000px less the 8px margins either side and the 8px gap
  // between them, each less its 1px borders. Height: the window less the
  // header (56px), the margin below (8px), the tab bar (36px) and the borders.
  await expectModuleText(app, VANILLA, "viewport", "486 × 598");
  await expectModuleText(app, REACT, "viewport", "486 × 598");
  expect(await inModule(app, VANILLA, "[innerWidth, innerHeight].join('x')")).toBe("486x598");
  await app.close();
});

test("a workspace opens with all its panels at once, behind one loader until the slowest has loaded", async () => {
  // Two modules for any game: one page loads at once, the other keeps its page busy for most of the time a page
  // may be held back (REVEAL_CAP_MS), well after the workspace has placed its panels.
  const root = await mkdtemp(path.join(tmpdir(), "tavora-modules-"));
  for (const [id, script] of [
    ["devtest.quick", ""],
    ["devtest.slow", "const end = Date.now() + 1500; while (Date.now() < end);"],
  ] as const) {
    const dir = path.join(root, id);
    await mkdir(path.join(dir, "dist"), { recursive: true });
    await writeFile(
      path.join(dir, "tavora.module.json"),
      JSON.stringify({ id, name: id, version: "0.1.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } }),
    );
    await writeFile(path.join(dir, "dist", "busy.js"), script);
    await writeFile(path.join(dir, "dist", "index.html"), `<!doctype html><meta charset="utf-8"><script src="busy.js"></script><p>${id}</p>`);
  }
  const { app, page } = await launch(undefined, [root]);
  try {
    await openModule(page, "devtest.quick");
    await openModule(page, "devtest.slow");
    await waitForShown(app, "devtest.slow");
    await openWorkspace(page, "satisfactory");

    // Notes, every few milliseconds, which of the two pages are shown.
    await app.evaluate(({ BrowserWindow }) => {
      const samples: string[] = [];
      const shown = (id: string) =>
        BrowserWindow.getAllWindows()[0]!.contentView.children.some((view) => {
          const contents = (view as unknown as { webContents?: { getURL(): string } }).webContents;
          return !!contents && contents.getURL().startsWith(`tavora-module://${id}/`) && (view as unknown as { getVisible(): boolean }).getVisible();
        });
      const timer = setInterval(() => samples.push(`${shown("devtest.quick")}/${shown("devtest.slow")}`), 10);
      Object.assign(globalThis, { switchSamples: samples, switchTimer: timer });
    });
    // Notes whether the workspace's loader came up, however briefly.
    await page.evaluate(() => {
      const seen = { loaders: false };
      new MutationObserver(() => (seen.loaders ||= !!document.querySelector('[data-testid="workspace-loading"]'))).observe(document.body, { childList: true, subtree: true });
      Object.assign(window, { switchSeen: seen });
    });
    await openWorkspace(page, "poe2");
    // Off the rail, whose tooltip would hide every panel while it shows.
    await page.mouse.move(700, 28);
    await waitForShown(app, "devtest.slow");
    await waitForShown(app, "devtest.quick");
    await expect(page.getByTestId("workspace-loading")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { switchSeen: { loaders: boolean } }).switchSeen.loaders)).toBe(true);
    const samples = await app.evaluate(() => {
      const state = globalThis as unknown as { switchSamples: string[]; switchTimer: ReturnType<typeof setInterval> };
      clearInterval(state.switchTimer);
      return state.switchSamples;
    });
    // The quick page waited for the slow one: never was one shown without the other.
    expect(samples).toContain("false/false");
    expect(samples.filter((sample) => sample === "true/false" || sample === "false/true")).toEqual([]);
  } finally {
    await app.close();
  }
});
