// Theme packages: picking a theme recolours the host and open module panels,
// the choice survives a restart, the player's own themes load from their
// themes folder, and Reset always brings the default back.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { desktopDir, inModule, launch, newUserData, openGame, openModule, VANILLA } from "./harness";

const rootToken = (page: Page, name: string) =>
  page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim(), name);

async function openAppearance(page: Page) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-appearance").click();
}

test("picking a theme recolours Tavora and its modules, and is kept after a restart", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await openGame(page, "poe2");
  await openModule(page, VANILLA);

  await openAppearance(page);
  await expect(page.getByTestId("theme-tavora.default")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("reset-theme")).toBeDisabled();
  await page.getByTestId("theme-tavora.nightfall").click();
  await expect(page.getByTestId("theme-tavora.nightfall")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => rootToken(page, "background")).toBe("#12161c");
  await page.getByTestId("variation-midnight").click();
  await expect.poll(() => rootToken(page, "background")).toBe("#0a0d12");
  // The module page's user stylesheet follows too.
  await expect
    .poll(() => inModule<string>(app, VANILLA, `getComputedStyle(document.documentElement).getPropertyValue("--tavora-background").trim()`))
    .toBe("#0a0d12");
  await app.close();

  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { theme: unknown };
  expect(saved.theme).toEqual({ id: "tavora.nightfall", variation: "midnight" });

  const again = await launch(userData);
  await expect.poll(() => rootToken(again.page, "background")).toBe("#0a0d12");
  await openAppearance(again.page);
  await again.page.getByTestId("reset-theme").click();
  await expect.poll(() => rootToken(again.page, "background")).toBe("#171412");
  await expect(again.page.getByTestId("theme-tavora.default")).toHaveAttribute("aria-pressed", "true");
  await again.app.close();
});

test("the player's own themes load from the themes folder, and broken ones say why", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  const official = JSON.parse(
    await readFile(path.resolve(desktopDir, "../../themes/nightfall/tavora.theme.json"), "utf8"),
  ) as { variations: { colors: Record<string, string> }[] };
  const colors = official.variations[0]!.colors;
  const write = async (folder: string, theme: unknown) => {
    await mkdir(path.join(userData, "themes", folder), { recursive: true });
    await writeFile(path.join(userData, "themes", folder, "tavora.theme.json"), JSON.stringify(theme));
  };
  await write("ash", { id: "community.ash", name: "Ash", version: "1.0.0", variations: [{ id: "dark", name: "Dark", mode: "dark", colors }] });
  await write("murky", {
    id: "community.murky",
    name: "Murky",
    version: "1.0.0",
    variations: [{ id: "dark", name: "Dark", mode: "dark", colors: { ...colors, "muted-foreground": "#2a2f38" } }],
  });

  await openAppearance(page);
  await expect(page.getByTestId("theme-community.ash")).toHaveCount(0);
  await page.getByTestId("reload-themes").click();
  await expect(page.getByTestId("theme-community.ash")).toContainText("Local");
  await expect(page.getByTestId("theme-problems")).toContainText("murky");
  await expect(page.getByTestId("theme-problems")).toContainText("muted-foreground on background");
  await page.getByTestId("theme-community.ash").click();
  await expect.poll(() => rootToken(page, "background")).toBe(colors.background);
  await app.close();
});
