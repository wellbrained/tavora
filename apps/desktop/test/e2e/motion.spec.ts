// Motion that users see and feel: dialogs rise as they fade in, a settings page picked with the pointer fades in (a
// key press stays instant), a row the user removes folds away, and a game picked on the rail fades in. Reduced motion
// keeps only the fade.
//
// Nothing here races a 100-250 ms animation: a recorder is installed in the page before the action and writes down every
// CSS animation that starts (and every Web Animation a row starts), and the test reads that afterwards. A test that says
// "nothing moved" first proves, with the same recorder, that something does move when it should.
import { expect, test, type Page } from "@playwright/test";
import { launch } from "./harness";

interface Seen {
  /** CSS animation name, or "animate" for a Web Animation. */
  name: string;
  /** The data-testid of the element, or of the first one inside it. */
  testid: string | null;
  /** A Web Animation of a row that changes its height. */
  height?: boolean;
}

/** Writes down what starts animating from now on, in `window.__seen`. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Seen[] = [];
    const w = window as unknown as { __seen?: Seen[]; __animate?: typeof Element.prototype.animate };
    w.__seen = seen;
    const idOf = (element: Element) => element.getAttribute("data-testid") ?? element.querySelector("[data-testid]")?.getAttribute("data-testid") ?? null;
    document.addEventListener("animationstart", (event) => seen.push({ name: event.animationName, testid: idOf(event.target as Element) }), true);
    if (!w.__animate) {
      w.__animate = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, frames, options) {
        const first = Array.isArray(frames) ? (frames[0] as Keyframe | undefined) : undefined;
        seen.push({ name: "animate", testid: idOf(this), height: !!first && "height" in first });
        return w.__animate!.call(this, frames, options);
      };
    }
  });
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);
const started = (page: Page, name: string, testid?: string) =>
  seen(page).then((list) => list.filter((item) => item.name === name && (testid === undefined || item.testid === testid)).length);

test("a dialog rises and fades in, and only fades with reduced motion", async () => {
  const { app, page } = await launch();
  await record(page);
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect.poll(() => started(page, "tavora-dialog-in", "settings")).toBe(1);
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);
  // It left with its own, quicker animation.
  expect(await started(page, "tavora-dialog-out", "settings")).toBe(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect.poll(() => started(page, "tavora-fade-in", "settings")).toBe(1);
  expect(await started(page, "tavora-dialog-in", "settings")).toBe(1);
  await app.close();
});

test("a settings page picked with the pointer fades in; one picked with the keyboard does not", async () => {
  const { app, page } = await launch();
  await record(page);
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings-page")).toBeVisible();
  // Opening to a page is the dialog's motion, not the page's.
  expect(await started(page, "tavora-page-in")).toBe(0);

  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-heading")).toHaveText("Appearance");
  await expect.poll(() => started(page, "tavora-page-in", "settings-page")).toBe(1);

  // A second pick while the first is still settling plays again, and the page ends up with nothing left on it.
  await page.getByTestId("settings-nav-general").click();
  await page.getByTestId("settings-nav-appearance").click();
  await expect.poll(() => started(page, "tavora-page-in")).toBeGreaterThan(1);
  await expect(page.getByTestId("settings-page")).not.toHaveClass(/tavora-page-in/);

  // The same pick with the keyboard: the recorder just showed it would have seen an animation.
  const before = await started(page, "tavora-page-in");
  await page.getByTestId("settings-nav-games").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-heading")).toHaveText("Games");
  await page.waitForTimeout(400);
  expect(await started(page, "tavora-page-in")).toBe(before);
  await app.close();
});

test("a row the user removes folds away; the rows around it stay", async () => {
  const { app, page } = await launch();
  await record(page);
  await page.getByTestId("rail-workspace-poe2").click({ button: "right" });
  await page.locator('[role="menu"][data-state="open"] [data-testid="menu-remove"]').click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  const rows = await seen(page);
  expect(rows).toContainEqual({ name: "animate", testid: "rail-workspace-poe2", height: true });
  expect(rows.filter((row) => row.name === "animate" && row.testid === "rail-workspace-satisfactory")).toEqual([]);
  await app.close();
});

test("a game moved into the favorites does not fold away in the main list", async () => {
  const { app, page } = await launch();
  await record(page);
  await page.getByTestId("rail-workspace-poe2").click({ button: "right" });
  await page.locator('[role="menu"][data-state="open"] [data-testid="menu-favorite"]').click();
  await expect(page.getByTestId("rail-favorite-poe2")).toBeVisible();
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  // (The menu has its own animation; what must not start is a row folding.)
  expect((await seen(page)).filter((item) => item.name === "animate")).toEqual([]);
  await app.close();
});

test("a workspace picked on the rail fades in; one picked with a hotkey does not", async () => {
  const { app, page } = await launch();
  const workspace = page.getByTestId("workspace");
  await record(page);
  await workspace.evaluate((element) => ((window as unknown as { __first: Element }).__first = element));

  await page.getByTestId("rail-workspace-satisfactory").click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-current", "page");
  // A new page was made for the game, and it faded in (opacity only).
  await expect.poll(() => started(page, "tavora-fade-in", "workspace")).toBe(1);
  expect(await workspace.evaluate((element) => element === (window as unknown as { __first: Element }).__first)).toBe(false);
  expect((await seen(page)).filter((item) => item.name === "tavora-fade-in").length).toBe(1);

  // The hotkey makes a new page too (so this is not a page that never changed), and it does not fade.
  await workspace.evaluate((element) => ((window as unknown as { __second: Element }).__second = element));
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveAttribute("aria-current", "page");
  expect(await workspace.evaluate((element) => element === (window as unknown as { __second: Element }).__second)).toBe(false);
  await page.waitForTimeout(400);
  expect(await started(page, "tavora-fade-in", "workspace")).toBe(1);
  await app.close();
});

test("with reduced motion a workspace picked on the rail still fades, and nothing moves", async () => {
  const { app, page } = await launch();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await record(page);
  await page.getByTestId("rail-workspace-satisfactory").click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-current", "page");
  await expect.poll(() => started(page, "tavora-fade-in", "workspace")).toBe(1);
  await app.close();
});
