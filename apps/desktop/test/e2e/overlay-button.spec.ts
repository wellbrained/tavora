import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launch, newUserData, seedLibrary } from "./harness";

// The Overlay button in the workspace header, in the hidden test app (never on screen).

const MODULES = path.resolve("../../modules");

test("the header button opens the Overlay page, pauses overlays", async () => {
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    const live = page.getByTestId("overlay-live");
    await expect(live).toHaveAttribute("data-state", "ready");
    await live.click();
    await expect(live).toHaveAttribute("data-state", "paused");
    await live.click();
    await expect(live).toHaveAttribute("data-state", "ready");
    await page.getByTestId("overlay-open").click();
    // The page replaces the workspace in the same window; no window of its own opens.
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await expect(page.getByTestId("workspace")).toHaveCount(0);
    expect(app.windows().some((window) => window.url().includes("layout.html") && !window.url().endsWith("#layer"))).toBe(false);
    // Any workspace on the rail leaves it.
    await page.getByTestId("rail-workspace-poe2").click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
