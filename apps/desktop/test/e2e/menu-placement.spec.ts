import { test, expect } from "@playwright/test";
import { launch } from "./harness";

test("a right-click menu opens next to its element, not at the pointer", async () => {
  const { app, page } = await launch();
  try {
    const icon = page.getByTestId("rail-workspace-poe2");
    const box = (await icon.boundingBox())!;
    // Right-click near the icon's left edge: a menu at the pointer would cover the icon.
    await icon.click({ button: "right", position: { x: 4, y: box.height / 2 } });
    const menu = page.locator('[role="menu"][data-state="open"]');
    await expect(menu).toBeVisible();
    const card = (await menu.boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(box.x + box.width);
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
  }
});
