// A dialog opened on top of another one stays inside it at any window size: here a confirmation over Settings.
// Placed against the window, it stuck out above Settings in tall and in short windows.
import { expect, test, type Page } from "@playwright/test";
import type { PublishView } from "../../src/shared/host-api";
import { launch, setContentSize } from "./harness";

async function placement(page: Page, innerId = "confirm", maxWidth = 420, outerId = "settings") {
  return page.evaluate(({ innerId, maxWidth, outerId }) => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const [outer, inner] = [box(outerId), box(innerId)];
    const element = document.querySelector(`[data-testid="${innerId}"]`)!;
    return {
      settingsFits: outer.top >= 0 && outer.left >= 0 && outer.bottom <= innerHeight && outer.right <= innerWidth,
      confirmInside: inner.top >= outer.top && inner.left >= outer.left && inner.bottom <= outer.bottom && inner.right <= outer.right,
      centered: Math.abs(inner.x + inner.width / 2 - outer.x - outer.width / 2) < 1 && Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2) < 1,
      onTop: element.contains(document.elementFromPoint(inner.x + inner.width / 2, inner.y + inner.height / 2)),
      // A confirmation keeps its own width instead of stretching to the width of Settings.
      confirmWidth: inner.width <= maxWidth,
    };
  }, { innerId, maxWidth, outerId });
}

test("a confirmation opened from Settings stays inside Settings", async ({}, testInfo) => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-game-poe2").click({ button: "right" });
    await page.locator('[role="menu"][data-state="open"] [data-testid="menu-manage-games"]').click();
    await page.getByTestId("games-select-all").check();
    await page.getByTestId("games-remove").click();
    await expect(page.getByTestId("confirm")).toBeVisible();

    for (const [name, width, height] of [
      ["normal", 1400, 900],
      ["tall", 1400, 1200],
      ["small", 900, 560],
    ] as const) {
      await setContentSize(app, width, height);
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height]);
      await expect.poll(() => placement(page), { message: name }).toEqual({ settingsFits: true, confirmInside: true, centered: true, onTop: true, confirmWidth: true });
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("confirm")).toHaveCount(0);
    await expect(page.getByTestId("settings")).toBeVisible();
  } finally {
    await app.close();
  }
});

for (const parent of ["Settings", "Add module"] as const) {
  test(`a long Publish review fits inside ${parent} and scrolls`, async ({}, testInfo) => {
    const { app, page } = await launch();
    const view: PublishView = {
      project: "layout-test",
      status: "ready",
      module: { id: "example.layout", name: "Layout test", version: "1.0.0", icon: null },
      notes: Array.from({ length: 40 }, (_, index) => `Change ${index + 1}: a long release note for checking the review's scrolling.`),
      asks: { network: [], connectors: [] },
      size: 1024,
      builtAt: null,
      sourceNewer: false,
      catalog: { kind: "first" },
      problems: [],
      newPrefix: null,
      ownPrefix: "example",
      error: null,
      published: null,
    };
    const outerId = parent === "Settings" ? "settings" : "add-module-dialog";
    try {
      if (parent === "Settings") {
        await page.getByTestId("rail-settings").click();
        await page.getByTestId("settings-nav-modules").click();
      } else {
        await page.getByTestId("add-module").click();
      }
      await expect(page.getByTestId(outerId)).toBeVisible();
      await app.evaluate(({ BrowserWindow }, view) => BrowserWindow.getAllWindows()[0]!.webContents.send("host:publish", view), view);
      await expect(page.getByTestId("publish-review")).toBeVisible();
      for (const [name, width, height] of [["normal", 1400, 900], ["small", 900, 560]] as const) {
        await setContentSize(app, width, height);
        await expect.poll(() => placement(page, "publish-review", 560, outerId)).toEqual({ settingsFits: true, confirmInside: true, centered: true, onTop: true, confirmWidth: true });
        const review = page.getByTestId("publish-review");
        await expect.poll(() => review.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        await review.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect.poll(() => review.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await page.screenshot({ path: testInfo.outputPath(`publish-${name}.png`), animations: "disabled" });
      }
    } finally {
      await app.close();
    }
  });
}
