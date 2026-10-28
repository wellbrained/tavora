// Plain words in the chrome: the permission prompt leads with its reason, Settings > Development waits
// until the user wants to make modules, the profile card saves on its own and leads to the account,
// and the expanded rail calls its top item Home.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launch, newUserData, openModule, openWorkspace } from "./harness";

/** The Let's go choice as library.json has it. */
const makesModulesIn = async (userData: string): Promise<unknown> =>
  JSON.parse(await readFile(path.join(userData, "library.json"), "utf8").catch(() => "{}")).makesModules;

const SYSTEM_MONITOR = "tavora.system-monitor";

test("the permission prompt asks with the reason and says who made the module", async () => {
  const { app, page } = await launch();
  try {
    await openWorkspace(page, "poe2");
    await openModule(page, SYSTEM_MONITOR);
    const dialog = page.getByTestId("grant-question");
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Let System Monitor see how busy your PC is?");
    await expect(dialog.getByTestId("grant-from")).toHaveText("One of Tavora's own modules. It only gets what you allow here.");
    await page.getByTestId("grant-cancel").click();
  } finally {
    await app.close();
  }
});

test("Development shows its tools only after Let's go, kept in the library file", async () => {
  const userData = await newUserData();
  const first = await launch(userData);
  try {
    await first.page.getByTestId("rail-settings").click();
    await first.page.getByTestId("settings-nav-development").click();
    await expect(first.page.getByTestId("development-intro")).toBeVisible();
    await expect(first.page.getByTestId("add-development-folder")).toHaveCount(0);
    await expect(first.page.getByTestId("development-examples")).toHaveCount(0);
    await first.page.getByTestId("development-start").click();
    await expect(first.page.getByTestId("add-development-folder")).toBeVisible();
    await expect(first.page.getByTestId("development-examples")).toBeVisible();
    await expect(first.page.getByTestId("development-examples")).not.toContainText("test ids");
    await expect.poll(() => makesModulesIn(userData)).toBe(true);
  } finally {
    await first.app.close();
  }

  // A new profile with only that library file (as a backup or the cloud copy brings it): no local storage, still shown.
  const elsewhere = await newUserData();
  await writeFile(path.join(elsewhere, "library.json"), await readFile(path.join(userData, "library.json"), "utf8"));
  const again = await launch(elsewhere);
  try {
    await again.page.getByTestId("rail-settings").click();
    await again.page.getByTestId("settings-nav-development").click();
    await expect(again.page.getByTestId("add-development-folder")).toBeVisible();
    await expect(again.page.getByTestId("development-intro")).toHaveCount(0);
  } finally {
    await again.app.close();
  }
});

test("a Let's go kept in the window's local storage moves into the library once", async () => {
  const userData = await newUserData();
  const { app, page } = await launch(userData);
  try {
    expect(await makesModulesIn(userData)).not.toBe(true);
    await page.evaluate(() => localStorage.setItem("tavora.makesModules", "1"));
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-development").click();
    await expect(page.getByTestId("add-development-folder")).toBeVisible();
    await expect(page.getByTestId("development-intro")).toHaveCount(0);
    await expect.poll(() => makesModulesIn(userData)).toBe(true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tavora.makesModules"))).toBeNull();
  } finally {
    await app.close();
  }
});

test("the profile card saves on Enter, keeps initials behind a link and opens the account", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-profile").click();
    const card = page.getByTestId("profile-card");
    await expect(card.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(card.getByTestId("profile-initials")).toHaveCount(0);

    await card.getByTestId("profile-name").fill("Mara Stone");
    await card.getByTestId("profile-name").press("Enter");
    await expect(card.getByTestId("profile-status")).toHaveText("Saved");
    await expect(page.getByTestId("rail-profile")).toHaveAttribute("aria-label", "Profile: Mara Stone");

    await card.getByTestId("profile-change-initials").click();
    await expect(card.getByTestId("profile-initials")).toBeFocused();
    await card.getByTestId("profile-initials").fill("MS");
    // Leaving the field saves too.
    await card.getByTestId("profile-name").focus();
    await expect(card.getByTestId("profile-status")).toHaveText("Saved");

    await card.getByTestId("profile-account").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("settings-nav-account")).toHaveAttribute("aria-current", "page");
  } finally {
    await app.close();
  }
});

test("the expanded rail calls its top item Home", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-toggle").click();
    await expect(page.getByTestId("rail-home")).toHaveText("Home");
  } finally {
    await app.close();
  }
});
