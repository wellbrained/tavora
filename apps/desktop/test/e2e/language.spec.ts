// Language: Tavora follows the system's language (German, or English for
// anything else), the player can pick one, and the pick is kept.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData } from "./harness";

test("Tavora follows a German system, and a pick switches the texts live and is kept", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData, [], { locale: "de-DE" });
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings-nav-general")).toContainText("Allgemein");
  await expect(page.getByTestId("language-system")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("rail-home")).toHaveAttribute("aria-label", "Startseite");
  await expect(page.getByTestId("rail-add-game")).toHaveAttribute("aria-label", "Spiel hinzufügen");
  await page.getByTestId("rail-settings").click();

  await page.getByTestId("language-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("settings-nav-general")).toContainText("General");
  await page.getByTestId("language-de").click();
  await expect(page.getByTestId("settings-nav-general")).toContainText("Allgemein");
  await page.getByTestId("language-en").click();
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
