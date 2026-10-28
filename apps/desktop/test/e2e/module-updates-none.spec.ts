// Check for updates with no community module installed says so, instead of "your community modules are up to date".
import { expect, test } from "@playwright/test";
import { launch } from "./harness";

test("checking for updates without community modules says there is nothing to update", async () => {
  // Nothing listens here; with no community module the check never needs the catalog.
  const { app, page } = await launch(undefined, [], { env: { TAVORA_API_URL: "http://127.0.0.1:9" } });
  try {
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-modules").click();
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByTestId("toast")).toHaveText("You have no community modules yet, so there's nothing to update.");
  } finally {
    await app.close();
  }
});
