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
    await expect(first.page.getByTestId("settings-heading")).toHaveText("Make modules");
    await expect(first.page.getByTestId("settings-tab-dev-folders")).toHaveCount(0);
    await expect(first.page.getByTestId("settings-tab-dev-help")).toHaveCount(0);
    await first.page.getByTestId("development-start").click();
    await expect(first.page.getByTestId("settings-heading")).toHaveText("Developer");
    await expect(first.page.getByTestId("settings-tab-development")).toHaveAttribute("data-state", "active");
    await expect(first.page.getByTestId("dev-modules-none")).toBeVisible();
    await first.page.getByTestId("settings-nav-development").click();
    await first.page.getByTestId("settings-tab-dev-folders").click();
    await expect(first.page.getByTestId("add-development-folder")).toBeVisible();
    await first.page.getByTestId("settings-nav-development").click();
    await first.page.getByTestId("settings-tab-dev-help").click();
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
    await expect(again.page.getByTestId("development-intro")).toHaveCount(0);
    await again.page.getByTestId("settings-nav-development").click();
    await again.page.getByTestId("settings-tab-dev-folders").click();
    await expect(again.page.getByTestId("add-development-folder")).toBeVisible();
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
    await expect(page.getByTestId("development-intro")).toHaveCount(0);
    await page.getByTestId("settings-nav-development").click();
    await page.getByTestId("settings-tab-dev-folders").click();
    await expect(page.getByTestId("add-development-folder")).toBeVisible();
    await expect.poll(() => makesModulesIn(userData)).toBe(true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("tavora.makesModules"))).toBeNull();
  } finally {
    await app.close();
  }
});

test("the profile dialog saves on Enter and on leaving a field, and has the account in its menu", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-profile").click();
    const profile = page.getByTestId("profile-dialog");
    await expect(profile.getByRole("button", { name: "Save" })).toHaveCount(0);

    await profile.getByTestId("profile-name").fill("Mara Stone");
    // The name beside the picture follows what is typed.
    await expect(profile.getByRole("heading", { name: "Mara Stone" })).toBeVisible();
    await profile.getByTestId("profile-name").press("Enter");
    await expect(profile.getByTestId("profile-status")).toHaveText("Saved");
    await expect(page.getByTestId("rail-profile")).toHaveAttribute("aria-label", "Profile: Mara Stone");

    await profile.getByTestId("profile-initials").fill("MS");
    // Leaving the field saves too.
    await profile.getByTestId("profile-name").focus();
    await expect(profile.getByTestId("profile-status")).toHaveText("Saved");

    await profile.getByTestId("profile-nav-account").click();
    await expect(profile.getByTestId("profile-nav-account")).toHaveAttribute("aria-current", "page");
    await expect(profile.getByTestId("account")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(profile).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("the expanded rail's top item shows the app's name and is called Home", async () => {
  const { app, page } = await launch();
  try {
    await page.getByTestId("rail-toggle").click();
    await expect(page.getByTestId("rail-home")).toHaveText("Tavora");
    await expect(page.getByTestId("rail-home")).toHaveAttribute("aria-label", "Home");
  } finally {
    await app.close();
  }
});
