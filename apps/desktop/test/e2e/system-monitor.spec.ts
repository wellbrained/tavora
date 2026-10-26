import { expect, test } from "@playwright/test";
import { expectModuleText, inModule, launch, openGame, openModule, shootPanels } from "./harness";

// The official System Monitor's apps dialog: the list Tavora reads for it alone (systemInfo.apps). That no other
// module gets it is tested in system-apps.test.ts.

const SYSTEM_MONITOR = "tavora.system-monitor";
const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;

test.skip(process.platform !== "win32", "the apps list reads Windows");

test("the Memory card lists the apps", async () => {
  const { app, page } = await launch();
  try {
    await openGame(page, "poe2");
    await openModule(page, SYSTEM_MONITOR);
    await page.getByTestId("grant-allow").click();
    await expect.poll(() => inModule(app, SYSTEM_MONITOR, `!!${q("show-apps")}`).catch(() => false)).toBe(true);
    await inModule(app, SYSTEM_MONITOR, `${q("show-apps")}.click()`);

    // Rows come in, Windows' own are marked, and the total line adds them up.
    await expect.poll(() => inModule<number>(app, SYSTEM_MONITOR, `document.querySelectorAll('[data-testid="app-row"]').length`), { timeout: 15_000 }).toBeGreaterThan(5);
    expect(await inModule<number>(app, SYSTEM_MONITOR, `document.querySelectorAll('[data-testid="app-windows"]').length`)).toBeGreaterThan(0);
    expect(await inModule<string>(app, SYSTEM_MONITOR, `${q("apps-total")}.textContent`)).toMatch(/^Shown: .+ GB of .+ GB in use$/);
    // Biggest first by RAM; a CPU figure follows after the second look.
    const rows = () => inModule<string[]>(app, SYSTEM_MONITOR, `[...document.querySelectorAll('[data-testid="app-row"]')].map((row) => row.textContent)`);
    await expect.poll(async () => (await rows()).some((row) => /\d %$/.test(row ?? ""))).toBe(true);
    await shootPanels(app, SYSTEM_MONITOR, test.info().outputPath("system-monitor-apps.png"));

    // Search narrows the list to what matches.
    await inModule(app, SYSTEM_MONITOR, `(() => { const input = ${q("apps-search")}; input.value = "zzzz-nothing"; input.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await expectModuleText(app, SYSTEM_MONITOR, "apps-none", "No app matches.");
  } finally {
    await app.close();
  }
});
