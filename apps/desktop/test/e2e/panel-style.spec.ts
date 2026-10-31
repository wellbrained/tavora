// Panel style (Settings > Appearance): Classic, Framed or Folders. Framed is the default; the framed styles set the
// module inside its panel's frame, and the choice is kept after a restart.
import { expect, test, type ElectronApplication } from "@playwright/test";
import { launch, NOTES, openModule, openWorkspace, waitForShown } from "./harness";

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
