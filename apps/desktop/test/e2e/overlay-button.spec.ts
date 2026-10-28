import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launch, newUserData, openModule, seedLibrary } from "./harness";

// The Overlay button in the workspace header, in the hidden test app (never on screen).

const MODULES = path.resolve("../../modules");

test("the header button opens the Overlay page, starts and stops overlays", async () => {
  const userData = await newUserData();
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "library.json"), JSON.stringify({ ...seedLibrary(), gameOverlays: true }));
  const { app, page } = await launch(userData, [MODULES], { seed: false });
  try {
    const live = page.getByTestId("overlay-live");
    // Overlays are stopped until the user starts them.
    await expect(live).toHaveAttribute("data-state", "stopped");
    await expect(live).toHaveText("Start");
    await live.click();
    await expect(live).toHaveAttribute("data-state", "ready");
    await expect(live).toHaveText("Stop");
    await live.click();
    await expect(live).toHaveAttribute("data-state", "stopped");
    // A workspace with a panel has the ▾ next to Add module; the page keeps it, dimmed, so the header never changes size.
    await openModule(page, "tavora.todos");
    await expect(page.getByTestId("modules-in-game")).toHaveCount(1);
    const before = (await page.getByTestId("overlay-open").boundingBox())!;
    const header = (await page.locator("header").boundingBox())!;
    const menus = await page.getByTestId("modules-in-game").count();
    await page.getByTestId("overlay-open").click();
    // The page replaces the workspace in the same window; no window of its own opens.
    await expect(page.getByTestId("overlay-page")).toBeVisible();
    await expect(page.getByTestId("workspace")).toHaveCount(0);
    // The header doesn't move: its buttons stay where the workspace has them, and the ones for a workspace can't be used.
    expect(await page.getByTestId("overlay-open").boundingBox()).toEqual(before);
    expect(await page.locator("header").boundingBox()).toEqual(header);
    await expect(page.getByTestId("add-module")).toBeVisible();
    await expect(page.getByTestId("modules-in-game")).toHaveCount(menus);
    expect(menus).toBe(1);
    await expect(page.getByTestId("overlay-live").locator("svg")).toBeVisible();
    expect(app.windows().some((window) => window.url().includes("layout.html") && !window.url().endsWith("#layer"))).toBe(false);
    // Any workspace on the rail leaves it.
    await page.getByTestId("rail-workspace-poe2").click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    await expect(page.getByTestId("overlay-page")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
