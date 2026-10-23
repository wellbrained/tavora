import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { expectModuleText, launch, openModule, shootPanels, shootWindow, VANILLA, waitForShown } from "./harness";

test("window pictures show the panels, which page.screenshot leaves empty", async ({}, info) => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected", 1);
  await waitForShown(app, VANILLA);

  const panelFiles = await shootPanels(app, VANILLA, info.outputPath("vanilla.png"));
  expect(panelFiles).toEqual([info.outputPath("vanilla-1.png"), info.outputPath("vanilla-2.png")]);
  for (const file of panelFiles) expect((await readFile(file)).length).toBeGreaterThan(0);
  await shootWindow(app, page, info.outputPath("window.png"));
  await page.screenshot({ path: info.outputPath("page.png") });

  // The middle of the first panel: as the panel shows it, in the window picture, and in page.screenshot.
  const bounds = await app.evaluate(({ BrowserWindow, WebContentsView }, id) => {
    const views = BrowserWindow.getAllWindows()[0]!.contentView.children.filter(
      (child): child is Electron.WebContentsView => child instanceof WebContentsView && child.webContents.getURL().startsWith(`tavora-module://${id}/`),
    );
    // The panel shootPanels saves first: the one made first.
    const view = views.sort((a, b) => a.webContents.id - b.webContents.id)[0]!;
    return view.getBounds();
  }, VANILLA);
  const base64 = async (name: string) => (await readFile(info.outputPath(name))).toString("base64");
  const [panel, window, plain] = [await base64("vanilla-1.png"), await base64("window.png"), await base64("page.png")];
  const pixels = await page.evaluate(
    async ({ panel, window, plain, bounds }) => {
      const pixel = async (png: string, x: number, y: number) => {
        const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], { type: "image/png" }));
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data).join(",");
      };
      const x = bounds.width / 2;
      const y = bounds.height / 2;
      return { panel: await pixel(panel, x, y), window: await pixel(window, bounds.x + x, bounds.y + y), plain: await pixel(plain, bounds.x + x, bounds.y + y) };
    },
    { panel, window, plain, bounds },
  );
  expect(pixels.window).toBe(pixels.panel);
  expect(pixels.plain).not.toBe(pixels.panel);
  await app.close();
});
