// Motion that users see and feel: dialogs rise as they fade in, a settings page picked with the pointer fades in (a
// key press stays instant), and a row the user removes folds away. Reduced motion keeps only the fade.
import { expect, test, type Page } from "@playwright/test";
import { launch } from "./harness";

/** The CSS animation a dialog is running right now. */
const animationOf = (page: Page, testid: string) =>
  page.evaluate((testid) => document.querySelector(`[data-testid="${testid}"]`)?.getAnimations().map((animation) => (animation as CSSAnimation).animationName) ?? [], testid);

test("a dialog rises and fades in, and only fades with reduced motion", async () => {
  const { app, page } = await launch();
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  // Settings keeps no other animation of its own, so the first is the dialog's.
  await expect.poll(() => animationOf(page, "settings")).toContain("tavora-dialog-in");
  await page.getByTestId("settings-close").click();
  await expect(page.getByTestId("settings")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("rail-settings").click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect.poll(() => animationOf(page, "settings")).toEqual(["tavora-fade-in"]);
  await app.close();
});

test("a settings page picked with the pointer fades in; one picked with the keyboard does not", async () => {
  const { app, page } = await launch();
  await page.getByTestId("rail-settings").click();
  const holder = page.getByTestId("settings-page");
  await expect(holder).toBeVisible();
  // Opening to a page is the dialog's motion, not the page's.
  await expect(holder).not.toHaveClass(/tavora-page-in/);

  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-heading")).toHaveText("Appearance");
  await expect(holder).toHaveClass(/tavora-page-in/);
  // It settles and leaves nothing behind.
  await expect(holder).not.toHaveClass(/tavora-page-in/);

  await page.getByTestId("settings-nav-games").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-heading")).toHaveText("Games");
  await expect(holder).not.toHaveClass(/tavora-page-in/);
  await app.close();
});

test("a row the user removes folds away; the rows around it stay", async () => {
  const { app, page } = await launch();
  // Every animation a row starts is written down, so the test does not race a 250 ms fold.
  await page.evaluate(() => {
    const seen: { testid: string | null; height: boolean }[] = [];
    (window as unknown as { __rows: typeof seen }).__rows = seen;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      const first = Array.isArray(frames) ? frames[0] : undefined;
      seen.push({ testid: this.querySelector("[data-testid]")?.getAttribute("data-testid") ?? this.getAttribute("data-testid"), height: !!first && "height" in first });
      return original.call(this, frames, options);
    };
  });
  await page.getByTestId("rail-workspace-poe2").click({ button: "right" });
  await page.locator('[role="menu"][data-state="open"] [data-testid="menu-remove"]').click();
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  const rows = await page.evaluate(() => (window as unknown as { __rows: { testid: string | null; height: boolean }[] }).__rows);
  expect(rows).toContainEqual({ testid: "rail-workspace-poe2", height: true });
  await app.close();
});

test("a workspace picked on the rail fades in; one picked with a hotkey does not", async () => {
  const { app, page } = await launch();
  const workspace = page.getByTestId("workspace");
  // The app starting on its last workspace is instant.
  await expect(workspace).not.toHaveClass(/tavora-quick-fade/);

  await page.getByTestId("rail-workspace-satisfactory").click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveAttribute("aria-current", "page");
  await expect(workspace).toHaveClass(/tavora-quick-fade/);
  // Opacity only: nothing moves, and the animation is short.
  const animation = await workspace.evaluate((element) => {
    const [fade] = element.getAnimations() as CSSAnimation[];
    return fade ? { name: fade.animationName, duration: fade.effect?.getTiming().duration } : null;
  });
  if (animation) expect(animation).toEqual({ name: "tavora-fade-in", duration: 125 });

  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveAttribute("aria-current", "page");
  await expect(workspace).not.toHaveClass(/tavora-quick-fade/);
  await app.close();
});
