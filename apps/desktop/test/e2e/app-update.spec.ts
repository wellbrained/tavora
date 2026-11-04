import { expect, test, type Page } from "@playwright/test";
import { launch } from "./harness";

// A development run never looks for real updates: "Check now" in Settings runs a made-up one (PreviewUpdater in
// src/main/updates.ts), which walks the rail's update marker through every step.

async function checkNow(page: Page, autoUpdate: boolean) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-about").click();
  const toggle = page.getByTestId("auto-update");
  if ((await toggle.getAttribute("data-state")) !== (autoUpdate ? "checked" : "unchecked")) await toggle.click();
  await page.getByTestId("check-updates").click();
  await page.getByTestId("settings-close").click();
}

test("the update marker shows what's new, the download's progress, and waits for Restart now", async () => {
  const { app, page } = await launch();
  try {
    await expect(page.getByTestId("rail-update")).toHaveCount(0);
    await checkNow(page, false);
    const marker = page.getByTestId("rail-update");
    await expect(marker).toHaveAttribute("data-status", "available");

    await marker.click();
    const popover = page.getByTestId("update-popover");
    await expect(popover).toBeVisible();
    // Next to the marker, not on top of it.
    const markerBox = (await marker.boundingBox())!;
    expect((await popover.boundingBox())!.x).toBeGreaterThanOrEqual(markerBox.x + markerBox.width);
    await expect(page.getByTestId("update-popover-notes").locator("li")).toHaveCount(3);

    await page.getByTestId("update-popover-download").click();
    await expect(page.getByTestId("update-popover-progress")).toBeVisible();
    await expect(page.getByTestId("rail-tile-progress")).toBeVisible();

    // Closed with a click beside it, the focus stays where it went: no outline on the marker next to its ring.
    await page.mouse.click(800, 300);
    await expect(popover).toHaveCount(0);
    expect(await marker.evaluate((element) => element.matches(":focus-visible"))).toBe(false);

    // Escape gives the focus back to the marker, for the keyboard.
    await marker.click();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(marker).toBeFocused();

    // The ring goes on, and the marker turns into Restart once it's done.
    await expect(marker).toHaveAttribute("data-status", "ready", { timeout: 20_000 });

    await marker.click();
    await page.getByTestId("update-popover-restart").click();
    // The preview ends instead of restarting.
    await expect(page.getByTestId("rail-update")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("a download that fails can be tried again from the marker", async () => {
  const { app, page } = await launch(undefined, [], { env: { TAVORA_FAKE_UPDATE_FAIL: "1" } });
  try {
    await checkNow(page, true);
    const marker = page.getByTestId("rail-update");
    await expect(marker).toHaveAttribute("data-status", "available", { timeout: 20_000 });
    await marker.click();
    await expect(page.getByTestId("update-popover-title")).toHaveText("Download didn't work");
    await expect(page.getByTestId("update-popover-download")).toHaveText("Try again");
  } finally {
    await app.close();
  }
});
