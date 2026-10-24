// A dialog opened on top of another one stays inside it at any window size: here a confirmation over Settings.
// Placed against the window, it stuck out above Settings in tall and in short windows.
import { expect, test, type Page } from "@playwright/test";
import { launch, setContentSize } from "./harness";

async function placement(page: Page) {
  return page.evaluate(() => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const [outer, inner] = [box("settings"), box("confirm")];
    return {
      settingsFits: outer.top >= 0 && outer.left >= 0 && outer.bottom <= innerHeight && outer.right <= innerWidth,
      confirmInside: inner.top >= outer.top && inner.left >= outer.left && inner.bottom <= outer.bottom && inner.right <= outer.right,
      // A confirmation keeps its own width instead of stretching to the width of Settings.
      confirmWidth: inner.width <= 420,
    };
  });
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
      await expect.poll(() => placement(page), { message: name }).toEqual({ settingsFits: true, confirmInside: true, confirmWidth: true });
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }
  } finally {
    await app.close();
  }
});
