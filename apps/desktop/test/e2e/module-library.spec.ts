import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, openModule, setContentSize } from "./harness";

test("80 modules distinguish ten game modules from duplicate panels", async () => {
  test.setTimeout(120_000);
  const userData = await newUserData();
  for (let index = 79; index >= 0; index--) {
    const number = String(index).padStart(3, "0");
    const dir = path.join(userData, "modules", "library-" + number);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify({
      id: "local.test.library-" + number, name: "Library module " + number,
      description: "A searchable module for a large game workspace.",
      version: "1.0.0", apiVersion: "1", entry: "index.html", games: [],
      viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] },
    }));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Library module</title>");
  }
  const { app, page } = await launch(userData);
  try {
    for (let index = 0; index < 10; index++) await openModule(page, "local.test.library-" + String(index).padStart(3, "0"));
    await openModule(page, "local.test.library-000");
    await page.getByTestId("add-module").click();
    const library = page.getByTestId("add-module-dialog");
    await expect.poll(async () => Math.round((await library.boundingBox())!.width)).toBe(1240);
    await expect.poll(async () => Math.round((await library.boundingBox())!.height)).toBe(852);
    await page.getByTestId("module-search").fill("Library module");
    await expect(page.getByTestId("module-results").locator("li")).toHaveCount(80);
    await expect(page.getByTestId("module-category-inGame")).toHaveText(/In this game\s*10/);
    await expect(page.getByTestId("in-game-local.test.library-000")).toHaveText("2 open");
    await expect(page.getByTestId("open-local.test.library-000")).toHaveText("Add another");
    const names = await page.getByTestId("module-results").locator("li").allTextContents();
    expect(names[0]).toContain("Library module 000");
    expect(names[79]).toContain("Library module 079");
    await page.getByTestId("module-category-inGame").click();
    await expect(page.getByTestId("module-results").locator("li")).toHaveCount(10);
    await expect(page.getByTestId("open-local.test.library-079")).toHaveCount(0);
    await page.getByTestId("module-category-all").click();
    await page.screenshot({ path: "test-results/module-library-80.png" });
    const searchBefore = await page.getByTestId("module-search").boundingBox();
    await page.getByTestId("module-results").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await page.getByTestId("module-search").boundingBox()).toEqual(searchBefore);
    await expect(page.getByTestId("open-local.test.library-079")).toBeVisible();
    await page.getByTestId("module-search").fill("no-such-module");
    await expect(page.getByTestId("module-search-empty")).toBeVisible();
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(page.getByTestId("module-search")).toHaveValue("");
    await page.getByTestId("module-search").fill("local.test.library-079");
    await expect(page.getByTestId("module-result-count")).toHaveText("1 module");
    await page.getByTestId("module-search").press("Enter");
    await expect(library).toHaveCount(0);
    await page.getByTestId("add-module").click();
    await setContentSize(app, 600, 500);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await expect.poll(async () => Math.round((await library.boundingBox())!.width)).toBe(viewport.width - 48);
    await expect.poll(async () => Math.round((await library.boundingBox())!.height)).toBe(Math.min(880, viewport.height - 48));
    await expect(page.getByTestId("module-search")).toBeVisible();
    await page.screenshot({ path: "test-results/module-library-narrow.png" });
    await page.getByTestId("manage-modules").click();
    await expect(library).toHaveCount(0);
    await expect(page.getByTestId("settings")).toBeVisible();
    await expect(page.getByTestId("install-module")).toBeVisible();
  } finally { await app.close(); }
});
