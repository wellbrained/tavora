// Design styles (docs/features/style-system.md): picking a style changes Tavora and its open panels at once, without a
// restart. The host page and every module page get data-style, a data-look per part and the --style-* sizes; the
// style's corner reaches modules as --radius; an inset style gives module panels the theme's dark colours over a light
// variation while Browser pages keep the host's; the pick is kept, and Reset goes back to Classic. The user's own
// styles load from their styles folder: New style copies the one in use, a broken file says why, Reload finds changes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  // Hardware, picked in Settings > Appearance: never used before, so it comes with its own theme. In Light.
  await openAppearance(page);
  await page.getByTestId("style-select").click();
  await page.getByTestId("style-tavora.hardware").click();
  await expect.poll(() => onHost(page, STYLE)).toBe("tavora.hardware");
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
  await expect.poll(() => inNotes(app, VAR("--background"))).toBe("#101113");
  expect(await inNotes(app, `document.documentElement.dataset.mode ?? ""`)).toBe("dark");
  await app.close();

  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { styleId?: unknown; theme?: { id?: unknown }; styleThemes?: Record<string, { id: string }> };
  expect(saved.styleId).toBe("tavora.hardware");
  expect(saved.theme?.id).toBe("tavora.hardware");
  // Classic keeps the theme it had, for when the user goes back to it.
  expect(saved.styleThemes?.["tavora.classic"]?.id).toBe("tavora.default");

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
  expect("styleThemes" in reset).toBe(false);
});

test("New style copies the style in use into the styles folder, and it can be picked", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await openAppearance(page);
  await page.getByTestId("style-select").click();
  await page.getByTestId("style-tavora.hardware").click();
  await expect.poll(() => onHost(page, STYLE)).toBe("tavora.hardware");

  await page.getByTestId("create-starter-style").click();
  // The file is written after the click returns: wait for it, don't read it once.
  const manifestPath = path.join(userData, "styles", "my-hardware", "tavora.style.json");
  await expect
    .poll(async () => {
      try {
        const m = JSON.parse(await readFile(manifestPath, "utf8")) as { id: string; name: string; looks: Record<string, string> };
        return [m.id, m.name, m.looks.tabs];
      } catch {
        return null;
      }
    })
    .toEqual(["local.my-hardware", "My Hardware", "keycap"]);
  await page.getByTestId("style-select").click();
  await expect(page.getByTestId("style-local.my-hardware")).toContainText("My Hardware");
  await expect(page.getByTestId("style-local.my-hardware")).toContainText("Local");
  // Classic first, then Tavora's own by name, the user's own last; only theirs carries a tag.
  const order = await page.locator('[data-testid="styles"] [data-testid^="style-"][role="option"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid")));
  expect(order[0]).toBe("style-tavora.classic");
  expect(order.at(-1)).toBe("style-local.my-hardware");
  await expect(page.getByTestId("style-local")).toHaveCount(1);
  await page.getByTestId("style-local.my-hardware").click();
  await expect.poll(() => onHost(page, STYLE)).toBe("local.my-hardware");
  expect(await onHost(page, LOOK("tabs"))).toBe("keycap");

  // A second copy gets a number of its own.
  await page.getByTestId("create-starter-style").click();
  await page.getByTestId("style-select").click();
  await expect(page.getByTestId("style-local.my-hardware-2")).toContainText("My Hardware 2");
  await page.keyboard.press("Escape");
  await app.close();
});

test("the user's own styles load on Reload, broken ones say why, and numbers out of range are kept in it", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  const looks = { surface: "glass", tabs: "keycap", content: "plain", buttons: "capsule", inputs: "capsule", lists: "inverted", labels: "caps-mono", status: "none" };
  const values = { borderWidth: 1, depth: 0, textSize: 14, controlHeight: 36, spacing: 1.1, glassOpacity: 0.8 };
  const write = async (folder: string, style: unknown) => {
    await mkdir(path.join(userData, "styles", folder), { recursive: true });
    await writeFile(path.join(userData, "styles", folder, "tavora.style.json"), JSON.stringify(style));
  };
  await write("airy", { id: "community.airy", name: "Airy", version: "1.0.0", looks, values: { ...values, textSize: 20 }, radius: 6, font: "nunito" });
  await write("knobs", { id: "community.knobs", name: "Knobs", version: "1.0.0", looks: { ...looks, buttons: "knob" }, values, radius: 6, font: "inter" });
  await write("fake", { id: "tavora.fake", name: "Fake", version: "1.0.0", looks, values, radius: 6, font: "inter" });

  await openAppearance(page);
  await page.getByTestId("style-select").click();
  await expect(page.getByTestId("style-tavora.classic")).toBeVisible();
  await expect(page.getByTestId("style-community.airy")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByTestId("reload-styles").click();
  await expect(page.getByTestId("style-problems")).toContainText("knobs");
  await expect(page.getByTestId("style-problems")).toContainText("looks.buttons must be one of");
  await expect(page.getByTestId("style-problems")).toContainText("fake");
  await expect(page.getByTestId("style-problems")).toContainText('reserved for Tavora\'s own styles');
  await expect(page.getByTestId("style-hints")).toContainText("airy");
  await expect(page.getByTestId("style-hints")).toContainText("values.textSize 20 is outside 12 to 15, so 15 is used");

  await page.getByTestId("style-select").click();
  await page.getByTestId("style-community.airy").click();
  await expect.poll(() => onHost(page, STYLE)).toBe("community.airy");
  expect(await onHost(page, LOOK("lists"))).toBe("inverted");
  expect(await onHost(page, VAR("--style-text"))).toBe("15px");
  expect(await onHost(page, VAR("--radius"))).toBe("6px");
  await app.close();
});
