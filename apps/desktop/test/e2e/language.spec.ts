// Language: Tavora follows the system's language (German, or English for
// anything else), the user can pick one from a list with a search field,
// the pick is kept, and the official modules follow it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { inModule, launch, newUserData, openGame, openModule, panels } from "./harness";

/** What a module's page shows, or nothing while its panel is still loading. */
const moduleText = (app: Parameters<typeof inModule>[0], id: string) => inModule<string>(app, id, "document.body.innerText").catch(() => "");

async function pickLanguage(page: Page, value: string) {
  await page.getByTestId("language-picker").click();
  await page.getByTestId(`language-option-${value}`).click();
}

test("Tavora follows a German system, and a pick from the list switches the texts live and is kept", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData, [], { locale: "de-DE" });
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings-nav-general")).toContainText("Allgemein");
  await expect(page.getByTestId("language-picker")).toContainText("System folgen");
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("rail-home")).toHaveAttribute("aria-label", "Startseite");
  await expect(page.getByTestId("rail-add-game")).toHaveAttribute("aria-label", "Spiel hinzufügen");
  await page.getByTestId("rail-settings").click();

  await pickLanguage(page, "en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("settings-nav-general")).toContainText("General");
  await expect(page.getByTestId("language-picker")).toContainText("English");

  // The search field narrows the list, by name or by another name of the language.
  await page.getByTestId("language-picker").click();
  await page.getByTestId("language-search").fill("german");
  await expect(page.getByTestId("language-option-de")).toBeVisible();
  await expect(page.getByTestId("language-option-en")).toHaveCount(0);
  await page.getByTestId("language-search").fill("zzz");
  await expect(page.getByTestId("language-none")).toBeVisible();
  await page.getByTestId("language-search").fill("deu");
  await page.getByTestId("language-search").press("Enter");
  await expect(page.getByTestId("settings-nav-general")).toContainText("Allgemein");

  await pickLanguage(page, "en");
  await app.close();

  const saved = JSON.parse(await readFile(path.join(userData, "library.json"), "utf8")) as { language: string };
  expect(saved.language).toBe("en");
  // English was picked, so a German system no longer decides.
  const again = await launch(userData, [], { locale: "de-DE" });
  await expect(again.page.locator("html")).toHaveAttribute("lang", "en");
  await again.app.close();
});

test("any other system language shows English", async () => {
  const { app, page } = await launch(undefined, [], { locale: "fr-FR" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await app.close();
});

test("the official modules follow the language, also when it changes while they are open", async () => {
  const { app, page } = await launch(undefined, [], { locale: "de-DE" });
  await openGame(page, "poe2");
  await openModule(page, "tavora.todos");
  await expect.poll(() => moduleText(app, "tavora.todos")).toContain("Behalte im Blick");

  await page.getByTestId("rail-settings").click();
  await pickLanguage(page, "en");
  await expect.poll(() => moduleText(app, "tavora.todos")).toContain("Keep track of what you want");
  await app.close();
});

test("module names follow the language, from the manifest's translations", async () => {
  const { app, page } = await launch(undefined, [], { locale: "de-DE" });
  await openGame(page, "poe2");
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId("add-module-dialog")).toContainText("Notizen");
  await page.getByTestId("open-tavora.notes").click();
  await expect(panels(page, "tavora.notes")).toContainText("Notizen");

  await page.getByTestId("rail-settings").click();
  await pickLanguage(page, "en");
  await expect(panels(page, "tavora.notes")).toContainText("Notes");
  await app.close();
});
