// Discord and AI Usage left Tavora for the catalog (the core frame decision, 2026-10-26). A workspace that
// still has their old panels keeps them, saying where they went, and the settings of their connectors stay
// out of sight until an installed module asks for them. Nothing here installs from the real catalog.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { HOSTILE, launch, newUserData, openModule, panels } from "./harness";

test("panels of the old Discord and AI Usage modules say they moved, and their settings stay hidden", async () => {
  const userData = await newUserData();

  // A workspace with two panels, then pointed at the old official modules the way an older Tavora saved them.
  const first = await launch(userData);
  await openModule(first.page, HOSTILE);
  await openModule(first.page, HOSTILE);
  await expect(panels(first.page, HOSTILE)).toHaveCount(2);
  // The layout is saved a moment after the last change.
  await first.page.waitForTimeout(1500);
  await first.app.close();
  const file = path.join(userData, "workspace.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  const records = saved.workspaces.poe2.instances as { moduleId: string; panelType?: string }[];
  expect(records).toHaveLength(2);
  records[0]!.moduleId = "tavora.discord";
  records[1]!.moduleId = "tavora.ai-usage";
  for (const record of records) delete record.panelType;
  // The second panel is left out of the layout, as when Tavora closed before the layout was saved: it is docked
  // again at start, though its module isn't installed (this used to stop Tavora from starting).
  const left = (saved.workspaces.poe2.instances as { instanceId: string }[])[1]!.instanceId;
  const strip = (node: { panels?: string[]; active?: string | null; children?: unknown[] }): void => {
    if (node.panels) {
      node.panels = node.panels.filter((id) => id !== left);
      if (node.active === left) node.active = node.panels[0] ?? null;
    }
    for (const child of node.children ?? []) strip(child as typeof node);
  };
  strip(saved.workspaces.poe2.layout.root);
  await writeFile(file, JSON.stringify(saved));

  const { app, page } = await launch(userData);
  try {
    // Both panels are kept, handed to the catalog modules, and offer to install them (not clicked: that would reach the catalog).
    const moved = page.locator('[data-testid^="panel-module-moved-"]');
    await expect(moved).toHaveCount(2);
    await expect(moved.first()).toContainText("Discord");
    await expect(moved.nth(1)).toContainText("AI Usage");
    await expect(page.getByTestId("install-moved-module")).toHaveCount(2);
    const kept = JSON.parse(await readFile(file, "utf8")).workspaces.poe2.instances as { moduleId: string }[];
    expect(kept.map((record) => record.moduleId).sort()).toEqual(["wellbrained.ai-usage", "wellbrained.discord"]);

    // No installed module asks for Discord or AI usage, so Settings > Integrations leaves them out.
    await page.getByTestId("rail-settings").click();
    await page.getByTestId("settings-nav-integrations").click();
    await expect(page.getByTestId("system-info-users-none").or(page.getByTestId("system-info-users"))).toBeVisible();
    await expect(page.getByTestId("discord-settings-connect")).toHaveCount(0);
    await expect(page.getByTestId("discord-sign-out")).toHaveCount(0);
    await expect(page.getByTestId("discord-users-none")).toHaveCount(0);
    await expect(page.getByTestId("ai-usage-add")).toHaveCount(0);
    await expect(page.getByTestId("ai-usage-accounts")).toHaveCount(0);
  } finally {
    await app.close();
  }
});
