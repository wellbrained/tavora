// The interface font (Settings > Appearance): picking one changes Tavora and its open panels at once, without a
// restart, and is kept. Every font is checked on the same screens: nothing it shows may be cut off, stick out or be
// smaller than 12 px where Inter fits (the SDK's layout checks), so a font that runs wider shows up here.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { checkLayout, type LayoutIssue } from "@tavora/sdk/testing";
import { UI_FONTS } from "../../src/shared/ui-fonts";
import { inModule, launch, layOutColumns, newUserData, NOTES, openModule, openWorkspace, TODOS } from "./harness";

const MODULES = [NOTES, TODOS];

async function openAppearance(page: Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
}

async function pick(page: Page, id: string) {
  await page.getByTestId("font-select").click();
  await page.getByTestId(`font-${id}`).click();
  await expect(page.getByTestId("fonts")).toHaveCount(0);
}

/** The font the page's body is in, once a file of it is in: its first family. (A page can hold two copies of a font.) */
const BODY_FONT = `(async () => {
  const first = getComputedStyle(document.body).fontFamily.split(",")[0].trim();
  await document.fonts.load("14px " + first);
  const name = first.replace(/["']/g, "");
  return [...document.fonts].some((face) => face.family.replace(/["']/g, "") === name && face.status === "loaded") ? name : "loading " + name;
})()`;

async function expectFont(app: ElectronApplication, page: Page, face: string) {
  await expect.poll(() => page.evaluate(BODY_FONT)).toBe(face);
  for (const moduleId of MODULES) await expect.poll(() => inModule<string>(app, moduleId, BODY_FONT), { message: moduleId }).toBe(face);
}

/** What the layout checks find on the Settings page and in each panel, as "where: kind" lines. */
async function issues(app: ElectronApplication, page: Page): Promise<string[]> {
  const found: string[] = [];
  const add = (place: string, list: LayoutIssue[]) => found.push(...list.map((issue) => `${place} ${issue.where}: ${issue.kind}`));
  add("settings", await checkLayout(page, "body"));
  for (const moduleId of MODULES) {
    const panel = { evaluate: (expression: string) => inModule(app, moduleId, expression), keyboard: { press: async () => {} } };
    add(moduleId, await checkLayout(panel, "body"));
  }
  return found;
}

test("every font shows at once in Tavora and its panels, fits where Inter fits, and is kept", async () => {
  // Two launches and seven fonts, each checked on three pages.
  test.setTimeout(180_000);
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await openWorkspace(page, "poe2");
  await layOutColumns(page, 2);
  for (const moduleId of MODULES) {
    await openModule(page, moduleId);
    await expect.poll(() => inModule<number>(app, moduleId, "document.body.innerText.length").catch(() => 0), { timeout: 15_000 }).toBeGreaterThan(0);
  }
  await openAppearance(page);
  await expect(page.getByTestId("font-select")).toContainText("Inter");
  await expectFont(app, page, "Inter Variable");
  const inter = new Set(await issues(app, page));

  for (const font of UI_FONTS.slice(1)) {
    await pick(page, font.id);
    await expect(page.getByTestId("font-select")).toContainText(font.name);
    await expectFont(app, page, font.face);
    const theirs = (await issues(app, page)).filter((issue) => !inter.has(issue));
    expect(theirs, font.name).toEqual([]);
  }

  // Kept: in the library, and after a restart.
  await pick(page, "saira");
  await expect.poll(async () => JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")).font).toBe("saira");
  await app.close();
  const again = await launch(userData);
  await expect.poll(() => again.page.evaluate(BODY_FONT)).toBe("Tavora Saira");

  // Reset brings Inter back with the rest of the look.
  await openAppearance(again.page);
  await again.page.getByTestId("reset-theme").click();
  await expect.poll(() => again.page.evaluate(BODY_FONT)).toBe("Inter Variable");
  await again.app.close();
  expect(JSON.parse(await readFile(path.join(userData, "library.json"), "utf8"))).not.toHaveProperty("font");
});
