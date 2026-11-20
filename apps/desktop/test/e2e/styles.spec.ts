// Design styles (docs/features/style-system.md): picking a style changes Tavora and its open panels at once, without a
// restart. The host page and every module page get data-style, a data-look per part and the --style-* sizes; the
// style's corner reaches modules as --radius; an inset style gives module panels the theme's dark colours over a light
// variation while Browser pages keep the host's; the pick is kept, and Reset goes back to Classic.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { inModule, launch, newUserData, NOTES, openModule, openWorkspace } from "./harness";

const onHost = (page: Page, script: string) => page.evaluate((code) => (0, eval)(code) as string, script);
const STYLE = `document.documentElement.dataset.style ?? ""`;
const LOOK = (part: string) => `document.documentElement.getAttribute("data-look-${part}") ?? ""`;
const VAR = (name: string) => `getComputedStyle(document.documentElement).getPropertyValue("${name}").trim()`;
const inNotes = (app: ElectronApplication, script: string) => inModule<string>(app, NOTES, script).catch(() => "");

async function openAppearance(page: Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
}

test("a style reaches Tavora and its panels at once, inset panels get dark colours, and the pick is kept", async () => {
  test.setTimeout(120_000);
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await openWorkspace(page, "poe2");
  await openModule(page, NOTES);

  // Classic from the start, on the host page and in the panel, with Classic's sizes.
  await expect.poll(() => onHost(page, STYLE)).toBe("tavora.classic");
  await expect.poll(() => inNotes(app, STYLE), { timeout: 15_000 }).toBe("tavora.classic");
  expect(await onHost(page, LOOK("tabs"))).toBe("pill");
  expect(await onHost(page, VAR("--style-control-height"))).toBe("32px");
  expect(await inNotes(app, VAR("--style-text"))).toBe("13px");

  // Hardware, picked in Settings > Appearance, with its own theme in Light.
  await openAppearance(page);
  await page.getByTestId("style-select").click();
  await page.getByTestId("style-tavora.hardware").click();
  await expect.poll(() => onHost(page, STYLE)).toBe("tavora.hardware");
  await page.getByTestId("theme-select").click();
  await page.getByTestId("theme-tavora.hardware").click();
  await page.getByTestId("mode-light").click();

  await expect.poll(() => onHost(page, LOOK("tabs"))).toBe("keycap");
  expect(await onHost(page, LOOK("content"))).toBe("inset");
  expect(await onHost(page, VAR("--style-control-height"))).toBe("30px");
  // The panel follows without a reload: the same marks, and the style's 4 px corner.
  await expect.poll(() => inNotes(app, STYLE)).toBe("tavora.hardware");
  expect(await inNotes(app, LOOK("buttons"))).toBe("keycap");
  expect(await inNotes(app, VAR("--radius"))).toBe("4px");
  // Inset: the host page is light, the module panel a dark screen in the theme's dark colours.
  await expect.poll(() => onHost(page, VAR("--background"))).toBe("#e2e3df");
  await expect.poll(() => inNotes(app, VAR("--background"))).toBe("#121314");
  expect(await inNotes(app, `document.documentElement.dataset.mode ?? ""`)).toBe("dark");
  await app.close();

  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { styleId?: unknown };
  expect(saved.styleId).toBe("tavora.hardware");

  // Kept after a restart; Reset goes back to Classic and leaves no style in the library.
  const again = await launch(userData);
  await expect.poll(() => onHost(again.page, STYLE)).toBe("tavora.hardware");
  await openAppearance(again.page);
  await again.page.getByTestId("reset-theme").click();
  await expect.poll(() => onHost(again.page, STYLE)).toBe("tavora.classic");
  expect(await onHost(again.page, LOOK("tabs"))).toBe("pill");
  await again.app.close();
  const reset = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as Record<string, unknown>;
  expect("styleId" in reset).toBe(false);
});
