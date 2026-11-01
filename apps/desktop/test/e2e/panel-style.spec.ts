// Panel style (Settings > Appearance): Classic, Framed or Folders. Framed is the default; the framed styles set the
// module inside its panel's frame, and the choice is kept after a restart.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { launch, layOutColumns, NOTES, openModule, openWorkspace, waitForShown } from "./harness";

/** Where the Notes panel's own view sits in the window. */
const viewBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, WebContentsView }, id) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(
      (child): child is Electron.WebContentsView => child instanceof WebContentsView && child.webContents.getURL().startsWith(`tavora-module://${id}/`),
    )!;
    return view.getBounds();
  }, NOTES);

test("the panel style is Framed at first, can be changed in Settings, and is kept", async () => {
  const { app, page, userData } = await launch();
  await openWorkspace(page, "poe2");
  await openModule(page, NOTES);
  await waitForShown(app, NOTES);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-panel-style", "framed");
  const framed = await viewBounds(app);

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("panel-style-classic").click();
  await expect(html).toHaveAttribute("data-panel-style", "classic");
  await page.getByTestId("settings-close").click();
  // Classic has no frame, so the module's view is wider than in Framed.
  await expect.poll(async () => (await viewBounds(app)).width).toBeGreaterThan(framed.width);

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
  await page.getByTestId("panel-style-folders").click();
  await expect(html).toHaveAttribute("data-panel-style", "folders");
  await app.close();

  const again = await launch(userData);
  await expect(again.page.locator("html")).toHaveAttribute("data-panel-style", "folders");
  await again.app.close();
});

test("the gaps between panels have the same colour as the header above them, in every style", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 2);
  const groups = page.locator(".dv-groupview");
  const [left, right] = [(await groups.nth(0).boundingBox())!, (await groups.nth(1).boundingBox())!];
  const x = Math.round((left.x + left.width + right.x) / 2);
  const workspace = (await page.getByTestId("workspace").boundingBox())!;
  const pixel = (y: number) => page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  for (const style of ["classic", "framed", "folders"]) {
    await page.evaluate((s) => (document.documentElement.dataset.panelStyle = s), style);
    expect(await pixel(Math.round(left.y + left.height / 2)), style).toEqual(await pixel(Math.round(workspace.y + 4)));
  }
  await app.close();
});

test("the window buttons sit on the page behind them: Home's background, the darker workspace canvas", async () => {
  const { app, page } = await launch();
  await page.getByTestId("rail-home").click();
  await expect(page.getByTestId("welcome")).toBeVisible();
  // The last colour the host gave the window buttons.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    const set = window.setTitleBarOverlay.bind(window);
    window.setTitleBarOverlay = (options) => {
      (globalThis as { buttons?: string | undefined }).buttons = options.color;
      set(options);
    };
  });
  const hex = (element: Element) => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `#${[r!, g!, b!].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  };
  const buttons = () => app.evaluate(() => (globalThis as { buttons?: string }).buttons);
  await openWorkspace(page, "poe2");
  const canvas = await page.getByTestId("workspace").evaluate(hex);
  await expect.poll(buttons).toBe(canvas);
  await page.getByTestId("rail-home").click();
  const home = await page.locator("body").evaluate(hex);
  expect(home).not.toBe(canvas);
  await expect.poll(buttons).toBe(home);
  await app.close();
});
