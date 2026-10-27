// Theme packages: picking a theme recolours the host and open module panels,
// the choice survives a restart, the user's own themes load from their
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
  // Nightfall comes in exactly Dark and Light, so the choice is the Light or dark row.
  await page.getByTestId("mode-light").click();
  await expect.poll(() => rootToken(page, "background")).toBe("#eef2f7");
  // The module page's user stylesheet follows too.
  await expect
    .poll(() => inModule<string>(app, VANILLA, `getComputedStyle(document.documentElement).getPropertyValue("--tavora-background").trim()`))
    .toBe("#eef2f7");
  await app.close();

  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { theme: unknown };
  expect(saved.theme).toEqual({ id: "tavora.nightfall", variation: "light" });

  const again = await launch(userData);
  await expect.poll(() => rootToken(again.page, "background")).toBe("#eef2f7");
  await openAppearance(again.page);
  await again.page.getByTestId("reset-theme").click();
  await expect.poll(() => rootToken(again.page, "background")).toBe("#171412");
  await expect(again.page.getByTestId("theme-tavora.default")).toHaveAttribute("aria-pressed", "true");
  await again.app.close();
});

test("Follow System shows the version that suits the system, and Dark or Light stays put", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData, [], { systemTheme: "light" });
  // Nobody has chosen: the Tavora theme follows the system, which is light here.
  await expect.poll(() => rootToken(page, "background")).toBe("#f6f2ea");
  await openAppearance(page);
  await expect(page.getByTestId("mode-system")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("reset-theme")).toBeDisabled();

  await page.getByTestId("mode-dark").click();
  await expect(page.getByTestId("mode-dark")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => rootToken(page, "background")).toBe("#171412");
  await expect(page.getByTestId("reset-theme")).toBeEnabled();
  await app.close();

  // Dark was chosen, so it stays dark after a restart although the system is light.
  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { followSystem: boolean };
  expect(saved.followSystem).toBe(false);
  const again = await launch(userData, [], { systemTheme: "light" });
  await expect.poll(() => rootToken(again.page, "background")).toBe("#171412");
  await openAppearance(again.page);
  await again.page.getByTestId("mode-system").click();
  await expect.poll(() => rootToken(again.page, "background")).toBe("#f6f2ea");
  await again.page.getByTestId("mode-dark").click();
  await again.page.getByTestId("reset-theme").click();
  await expect(again.page.getByTestId("mode-system")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => rootToken(again.page, "background")).toBe("#f6f2ea");
  await again.app.close();
});

test("the user's own themes load from the themes folder, and broken ones say why", async () => {  const userData = await newUserData();
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

test("New theme copies the Tavora theme into the themes folder as a theme to change", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  await openAppearance(page);
  await page.getByTestId("create-starter-theme").click();
  await expect(page.getByTestId("theme-local.my-theme")).toContainText("My theme");
  const manifest = JSON.parse(await readFile(path.join(userData, "themes", "my-theme", "tavora.theme.json"), "utf8")) as { id: string };
  expect(manifest.id).toBe("local.my-theme");
  await page.getByTestId("create-starter-theme").click();
  await expect(page.getByTestId("theme-local.my-theme-2")).toContainText("My theme 2");
  await app.close();
});
