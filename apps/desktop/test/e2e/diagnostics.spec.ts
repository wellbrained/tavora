// Settings > Diagnostic info copies a report with no private data, and the
// timings in it stay inside budgets: how long Tavora takes to start, to switch
// workspaces and to open a panel. The budgets have headroom over what a normal PC
// takes, so they catch a real slowdown, not noise.
import { homedir } from "node:os";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launch, openWorkspace, openModule, VANILLA } from "./harness";

async function copyReport(app: ElectronApplication, page: Page): Promise<string> {
  await page.getByTestId("copy-diagnostics").click();
  await expect(page.getByTestId("copy-diagnostics")).toHaveText("Copied");
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function timing(report: string, name: string, column: "median" | "slowest" = "median"): number {
  const line = report.split("\n").find((item) => item.trim().startsWith(`${name}:`));
  if (!line) throw new Error(`no ${name} timing in the report`);
  const [median, , slowest] = line.split(":")[1]!.split(",").map(Number);
  return column === "median" ? median! : slowest!;
}

test("Copy diagnostic info has what helps and nothing private, and the timings are inside budget", async () => {
  const { app, page, userData } = await launch();
  // Several switches, so one cold first switch does not decide it.
  for (const id of ["satisfactory", "poe2", "satisfactory", "poe2"]) await openWorkspace(page, id);
  await openModule(page, VANILLA);
  // The panel's own load is what its timing waits for, so ask again until it is in the report.
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("settings-nav-about").click();
  await expect.poll(() => copyReport(app, page), { timeout: 15_000 }).toContain("panel-open:");
  const report = await copyReport(app, page);

  expect(report).toMatch(/^Tavora diagnostic info\nVersion: \d+\.\d+\.\d+ \(development run\)/);
  expect(report).toContain("Last errors:");
  // No folders of this PC and no workspace names.
  for (const secret of [homedir(), userData, "Path of Exile", "Satisfactory"]) expect(report).not.toContain(secret);

  expect.soft(timing(report, "startup"), "startup").toBeLessThan(BUDGET.startup);
  expect.soft(timing(report, "workspace-switch"), "workspace switch, typical").toBeLessThan(BUDGET.workspaceSwitch);
  expect.soft(timing(report, "workspace-switch", "slowest"), "workspace switch, slowest").toBeLessThan(BUDGET.workspaceSwitchSlowest);
  expect.soft(timing(report, "panel-open"), "panel open").toBeLessThan(BUDGET.panelOpen);
  await app.close();
});

// Measured on the development PC: startup about 360, a typical switch 25 (the first, cold one 250), a panel 100.
// The budgets are the plan's targets or about five times the measurement, whichever is looser, for slower machines.
// CI draws everything in software on a shared machine (measured there: startup 3800, a typical switch 2000), so
// it only catches a collapse; the real budgets are enforced where `pnpm release` runs the tests, on a real PC.
const SCALE = process.env.CI ? 20 : 1;
const BUDGET = { startup: 2000 * SCALE, workspaceSwitch: 150 * SCALE, workspaceSwitchSlowest: 1000 * SCALE, panelOpen: 600 * SCALE };