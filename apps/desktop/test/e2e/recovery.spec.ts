// Milestone B gate: a module that fails to load, hangs or crashes is shown
// as such, can be recovered from the panel header, and keeps its data.

import { cp, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  clickInModule,
  expectModuleText,
  FIXTURES,
  HOSTILE,
  inModule,
  launch,
  openModule,
  panels,
  VANILLA,
} from "./harness";

const BROKEN = "local.test.broken-module";

test("a module whose page fails to load shows Reload and recovers", async () => {
  // A copy of the hostile fixture under another id, so the test can break it.
  const dir = path.join(await mkdtemp(path.join(tmpdir(), "tavora-broken-")), "broken-module");
  await cp(path.join(FIXTURES, "hostile-module"), dir, { recursive: true });
  const manifestFile = path.join(dir, "tavora.module.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, unknown>;
  delete manifest.$schema;
  await writeFile(manifestFile, JSON.stringify({ ...manifest, id: BROKEN, name: "Broken Module" }));

  const { app, page } = await launch(undefined, [dir]);
  // The entry existed when Tavora started; it disappears before the panel opens.
  await rename(path.join(dir, "index.html"), path.join(dir, "index.html.away"));
  await openModule(page, BROKEN);
  await expect(panels(page, BROKEN)).toHaveAttribute("data-status", "failed");
  await expect(panels(page, BROKEN).getByTestId("reload")).toBeVisible();

  await rename(path.join(dir, "index.html.away"), path.join(dir, "index.html"));
  await panels(page, BROKEN).getByTestId("reload").click();
  await expect(panels(page, BROKEN)).toHaveAttribute("data-status", "ready");
  await expect.poll(() => inModule(app, BROKEN, "typeof window.runProbes").catch(() => null)).toBe("function");
  await expect(panels(page, BROKEN).getByTestId("reload")).toHaveCount(0);
  await app.close();
});

test("a hung module is reported, can be stopped and reloaded, and others keep working", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await openModule(page, HOSTILE);
  await expectModuleText(app, VANILLA, "status", "Connected");
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.hang").catch(() => null)).toBe("function");

  await inModule(app, HOSTILE, "hang()");
  // The host notices within its heartbeat timeout, without any input.
  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "unresponsive", { timeout: 20_000 });
  await expect(panels(page, HOSTILE).getByTestId("stop")).toBeVisible();

  // The other module is unaffected while this one hangs.
  await clickInModule(app, VANILLA, "increment");
  await expectModuleText(app, VANILLA, "count", "1");

  await panels(page, HOSTILE).getByTestId("stop").click();
  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "crashed");
  await panels(page, HOSTILE).getByTestId("reload").click();
  await expect(panels(page, HOSTILE)).toHaveAttribute("data-status", "ready");
  await expect.poll(() => inModule(app, HOSTILE, "typeof window.hang").catch(() => null)).toBe("function");
  await app.close();
});

test("a crashed module reloads with its saved data intact", async () => {
  const { app, page } = await launch();
  await openModule(page, VANILLA);
  await expectModuleText(app, VANILLA, "status", "Connected");
  for (let i = 0; i < 2; i++) await clickInModule(app, VANILLA, "increment");
  await expectModuleText(app, VANILLA, "count", "2");
  await inModule(
    app,
    VANILLA,
    `document.querySelector('[data-testid="note"]').value = "before the crash";
     document.querySelector('[data-testid="save-note"]').click()`,
  );
  await expectModuleText(app, VANILLA, "note-revision", "1");

  const pid = await app.evaluate(({ webContents }, id) => {
    return webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith(`tavora-module://${id}/`))!
      .getOSProcessId();
  }, VANILLA);
  process.kill(pid, "SIGKILL");
  await expect(panels(page, VANILLA)).toHaveAttribute("data-status", "crashed");

  await panels(page, VANILLA).getByTestId("reload").click();
  await expect(panels(page, VANILLA)).toHaveAttribute("data-status", "ready");
  await expectModuleText(app, VANILLA, "status", "Connected");
  await expectModuleText(app, VANILLA, "count", "2");
  await expectModuleText(app, VANILLA, "note-revision", "1");
  expect(await inModule(app, VANILLA, `document.querySelector('[data-testid="note"]').value`)).toBe("before the crash");
  await app.close();
});
