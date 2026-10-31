// A panel's dialog: centred over the workspace area, and the welcome a panel just added may open on its own (the Add
// click carries over), which a click beside it doesn't close.

import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { desktopDir, expectModuleText, inModule, launch, panels } from "./harness";

const PROBES = path.join(desktopDir, "test/dialog-fixtures");
const PROBE = "local.test.welcome-probe";

/** A real key press in the probe's page, so what follows counts as the user's own. */
async function gesture(app: ElectronApplication) {
  await app.evaluate(({ webContents }, moduleId) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
    if (!target) throw new Error("no panel");
    target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
    target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
  }, PROBE);
}

type Answer = { ok: boolean; error?: { code: string } };
const openDialog = (app: ElectronApplication) => inModule<Answer>(app, PROBE, `window.probe.call("panel.setDialog", { open: true, width: 480, height: 320 })`);

/** Adds one panel of the probe from the module library, which stays open for the next one. */
async function addProbe(page: Page) {
  await page.getByTestId("add-module").click();
  await page.getByTestId(`panel-menu-toggle-${PROBE}`).click();
  await page.getByTestId(`open-${PROBE}-welcome`).click();
}

/** A click on the dimmed rail, beside the dialog. */
async function clickBeside(page: Page) {
  await page.mouse.click(30, 450);
}

test("a panel just added opens its welcome over the workspace, and a click beside it doesn't close it", async () => {
  const { app, page, userData } = await launch(undefined, [PROBES]);
  try {
    await addProbe(page);
    await expectModuleText(app, PROBE, "probe-auto", "opened");
    const frame = page.getByTestId("panel-dialog");
    await expect(frame).toBeVisible();
    await expect(frame).not.toHaveAttribute("data-closes-on-click-beside");
    // The welcome is the next step after Add: the library steps aside.
    await expect(page.getByTestId("add-module-dialog")).toHaveCount(0);

    // Centred over the workspace area and inside it: the rail and the header stay in sight around it.
    const area = (await page.locator("[data-workspace-area]").boundingBox())!;
    await expect.poll(async () => {
      const box = (await frame.boundingBox())!;
      return Math.abs(box.x + box.width / 2 - (area.x + area.width / 2)) < 2 && Math.abs(box.y + box.height / 2 - (area.y + area.height / 2)) < 2;
    }).toBe(true);
    const box = (await frame.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(area.x);
    expect(box.y).toBeGreaterThanOrEqual(area.y);
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
    expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);

    await clickBeside(page);
    await page.waitForTimeout(300);
    await expect(frame).toBeVisible();

    await page.getByTestId("panel-dialog-close").click();
    await expect(frame).toHaveCount(0);

    // Once only: without a press the next one is refused.
    expect((await openDialog(app)).error?.code).toBe("PERMISSION_DENIED");
    await expect(frame).toHaveCount(0);

    // Opened by a press, a click beside it closes it as before.
    await gesture(app);
    expect((await openDialog(app)).ok).toBe(true);
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("data-closes-on-click-beside", "");
    await clickBeside(page);
    await expect(frame).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Restored after a restart, the panel gets no welcome.
  const again = await launch(userData, [PROBES]);
  try {
    await expectModuleText(again.app, PROBE, "probe-launch", "restore");
    await expectModuleText(again.app, PROBE, "probe-status", "ready");
    await expect(again.page.getByTestId("panel-dialog")).toHaveCount(0);
    expect((await openDialog(again.app)).error?.code).toBe("PERMISSION_DENIED");
  } finally {
    await again.app.close();
  }
});

test("opening several panels from the dialog puts the panel back in its slot first", async () => {
  const { app, page } = await launch(undefined, [PROBES]);
  try {
    await addProbe(page);
    await expectModuleText(app, PROBE, "probe-auto", "opened");
    await expect(page.getByTestId("panel-dialog")).toBeVisible();

    await gesture(app);
    const answer = await inModule<{ ok: boolean; result?: Record<string, string> }>(app, PROBE, `window.probe.call("panels.openMany", { types: ["welcome", "other"] })`);
    expect(answer.result).toEqual({ welcome: "shown", other: "opened" });
    await expect(page.getByTestId("panel-dialog")).toHaveCount(0);
    await expect(panels(page, PROBE)).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test("Add all gives one welcome, from the last panel only, the one in front", async () => {
  const { app, page } = await launch(undefined, [PROBES]);
  try {
    await page.getByTestId("add-module").click();
    await page.getByTestId(`open-all-${PROBE}`).click();
    await expectModuleText(app, PROBE, "probe-auto", "PERMISSION_DENIED", 0);
    await expectModuleText(app, PROBE, "probe-auto", "opened", 1);
    await expect(page.getByTestId("panel-dialog")).toHaveCount(1);
    await expect(panels(page, PROBE)).toHaveCount(2);
  } finally {
    await app.close();
  }
});
