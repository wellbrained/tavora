// Undo instead of "Are you sure?": deleting a layout, a folder, a workspace (to Trash) or a to-do group happens at once
// and a toast offers Undo for a few seconds (undoable in the kit). Undo puts the thing back exactly as it was; once the
// toast goes, or the app closes, the delete stays.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { inModule, launch, layOutColumns, openModule, openWorkspace, TODOS, typeInModule, VANILLA, waitForShown, answerPrompt, toastsPage, layoutMenu, fromMenu, q, hostToast } from "./harness";

async function saveLayout(page: Page, name: string) {
  await page.getByTestId("layouts").click();
  await page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]').click();
  await answerPrompt(page, name);
}

/** The names of the saved layouts, as the Layouts menu lists them. */
async function layoutNames(page: Page): Promise<string[]> {
  await page.getByTestId("layouts").click();
  await expect(page.locator('[role="menu"][data-state="open"] [data-testid="layout-save"]')).toBeVisible();
  // Each saved layout is a submenu whose test id is layout-<its id>.
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="menu"][data-state="open"] [data-testid^="layout-"]'))
      .filter((element) => /^layout-[0-9a-f]{8}-/.test(element.dataset.testid ?? ""))
      .map((element) => element.textContent!.trim()),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
  return names;
}

const toast = (page: Page, title: string) => hostToast(page, "undo-toast").filter({ hasText: title });

test("a deleted layout comes back with Undo or Ctrl+Z, also after a switch to another workspace", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  await saveLayout(page, "Mapping");
  await saveLayout(page, "Bossing");
  expect(await layoutNames(page)).toEqual(["Mapping", "Bossing"]);

  // No question first: it is gone at once, and the toast says so, once, to screen readers too.
  await layoutMenu(page, "Mapping", "layout-delete");
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect(toast(page, "Layout deleted")).toBeVisible();
  await expect(toastsPage(page).getByTestId("toast-status")).toHaveText("Layout deleted");
  expect(await layoutNames(page)).toEqual(["Bossing"]);

  // The user goes to another workspace; Undo still puts the layout back into the one it came from, in its place.
  await openWorkspace(page, "satisfactory");
  await toast(page, "Layout deleted").getByTestId("undo").click();
  await expect(hostToast(page, "undo-toast")).toHaveCount(0);
  await openWorkspace(page, "poe2");
  expect(await layoutNames(page)).toEqual(["Mapping", "Bossing"]);

  // The Undo button is reachable by keyboard, and Ctrl+Z takes back the newest delete outside text fields.
  await layoutMenu(page, "Bossing", "layout-delete");
  await expect(toast(page, "Layout deleted")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(hostToast(page, "undo-toast")).toHaveCount(0);
  expect(await layoutNames(page)).toEqual(["Mapping", "Bossing"]);
  // Nothing left to undo: another Ctrl+Z does nothing.
  await page.keyboard.press("Control+z");
  expect(await layoutNames(page)).toEqual(["Mapping", "Bossing"]);
  await app.close();
});

test("two quick deletes get an Undo each; undoing the first leaves the second deleted", async () => {
  const { app, page } = await launch();
  await fromMenu(page, "poe2", "menu-remove");
  await fromMenu(page, "satisfactory", "menu-remove");
  await expect(page.getByTestId("rail-workspace-poe2")).toHaveCount(0);
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);
  await expect(hostToast(page, "undo-toast")).toHaveCount(2);

  // Spread the stack (pointing at it), then Undo on the older one.
  await toast(page, "Satisfactory moved to Trash").hover();
  await toast(page, "Path of Exile 2 moved to Trash").getByTestId("undo").click();
  await expect(page.getByTestId("rail-workspace-poe2")).toBeVisible();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toHaveCount(0);
  // It is back where it was: first in the rail, and open again, since the user was still on the start screen.
  await expect(page.locator('[data-testid^="rail-workspace-"]').first()).toHaveAttribute("data-testid", "rail-workspace-poe2");
  await expect(page.getByTestId("welcome")).toHaveCount(0);

  await toast(page, "Satisfactory moved to Trash").getByTestId("undo").click();
  await expect(page.getByTestId("rail-workspace-satisfactory")).toBeVisible();
  await app.close();
});

test("a delete is final once the toast goes, and when the app closes during it", async () => {
  const running = await launch();
  const { page, userData } = running;
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  await saveLayout(page, "Mapping");
  await saveLayout(page, "Bossing");

  // Closed with the toast's X: no Undo any more.
  await layoutMenu(page, "Mapping", "layout-delete");
  await toast(page, "Layout deleted").getByRole("button", { name: "Dismiss" }).click();
  await expect(hostToast(page, "undo-toast")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  expect(await layoutNames(page)).toEqual(["Bossing"]);

  // Closed while the toast still shows: the delete was saved at once, so it stays deleted, never half-done.
  await layoutMenu(page, "Bossing", "layout-delete");
  await expect(toast(page, "Layout deleted")).toBeVisible();
  await running.app.close();
  const again = await launch(userData);
  await expect(hostToast(again.page, "undo-toast")).toHaveCount(0);
  await again.page.getByTestId("layouts").click();
  await expect(again.page.locator('[role="menu"][data-state="open"]').getByText("Bossing", { exact: true })).toHaveCount(0);
  await again.page.keyboard.press("Escape");
  await again.app.close();
});

test("the Undo toast waits while Tavora is behind the game, and counts down again when the user is back", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  await saveLayout(page, "Mapping");
  await saveLayout(page, "Bossing");

  // The window loses the focus to the game (the page is not hidden, so only the window's blur tells).
  await layoutMenu(page, "Mapping", "layout-delete");
  await expect(toast(page, "Layout deleted")).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.emit("blur")));
  // Longer than the toast stays (5 s): it is still there, with its Undo.
  await page.waitForTimeout(6500);
  await expect(toast(page, "Layout deleted")).toBeVisible();

  // Back in front: it goes after its time, and not before the user had a second to see it.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.emit("focus")));
  await expect(hostToast(page, "undo-toast")).toHaveCount(0, { timeout: 10_000 });
  await app.close();
});

test("the Undo button reads as big as the message and is easy to hit, in a compact toast", async () => {
  const { app, page } = await launch();
  await layOutColumns(page, 2);
  await openModule(page, VANILLA);
  await saveLayout(page, "Mapping");
  await layoutMenu(page, "Mapping", "layout-delete");
  const pill = toast(page, "Layout deleted");
  await expect(pill).toBeVisible();
  // Let the toast settle before measuring (it slides in).
  await page.waitForTimeout(500);
  const measured = await pill.evaluate((element) => {
    const size = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector)!;
      const box = target.getBoundingClientRect();
      return { width: box.width, height: box.height, fontSize: getComputedStyle(target).fontSize };
    };
    const edges = (selector: string) => {
      const box = element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { left: box.left, right: box.right };
    };
    const text = edges(".tavora-toast-text");
    const undo = edges('[data-testid="undo"]');
    const close = edges(".tavora-toast-close");
    return {
      pill: element.getBoundingClientRect().height,
      title: size(".tavora-toast-title"),
      undo: size('[data-testid="undo"]'),
      close: size(".tavora-toast-close"),
      textToUndo: undo.left - text.right,
      undoToClose: close.left - undo.right,
    };
  });
  // Room between the parts: 20 px from the message to Undo, 12 px from Undo to the close button.
  expect(measured.textToUndo).toBeCloseTo(20, 0);
  expect(measured.undoToClose).toBeCloseTo(12, 0);
  expect(measured.undo.fontSize).toBe(measured.title.fontSize);
  // At least the kit's small button (28 px), and room around the word; the X as high.
  expect(measured.undo.height).toBeGreaterThanOrEqual(28);
  expect(measured.undo.width).toBeGreaterThanOrEqual(56);
  expect(measured.close.height).toBeGreaterThanOrEqual(28);
  expect(measured.close.width).toBeGreaterThanOrEqual(28);
  expect(measured.pill).toBeLessThanOrEqual(48);
  await app.close();
});

// ── A module: To-Dos, in its own view ──────────────────────────────────

async function addInto(app: ElectronApplication, formExpr: string, text: string) {
  await inModule(
    app,
    TODOS,
    `(() => {
      const form = ${formExpr};
      const input = form.querySelector("input");
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()`,
  );
}

const groupNamed = (name: string) =>
  `[...document.querySelectorAll('section[data-testid^="group-"]')].find((el) => el.querySelector('[data-testid="group-name"]')?.textContent.trim() === ${JSON.stringify(name)})`;
const groupNames = (app: ElectronApplication) => inModule<string[]>(app, TODOS, `[...document.querySelectorAll('[data-testid="group-name"]')].map((el) => el.textContent.trim())`);
const taskTitles = (app: ElectronApplication) => inModule<string[]>(app, TODOS, `[...document.querySelectorAll('[data-testid="task-title"]')].map((el) => el.textContent.trim())`);
const toasts = (app: ElectronApplication) => inModule<string[]>(app, TODOS, `[...document.querySelectorAll('[data-testid="undo-toast"]')].map((el) => el.innerText.split("\\n")[0].trim())`);

/** Deletes a group from its ⋯ menu, which Tavora draws over the panel; only a real key press opens it. */
async function deleteGroup(app: ElectronApplication, page: Page, name: string) {
  await inModule(app, TODOS, `${groupNamed(name)}.querySelector('[data-testid="group-menu"]').focus()`);
  await typeInModule(app, TODOS, "\n");
  await expect(page.getByTestId("module-menu")).toBeVisible();
  await page.getByTestId("module-menu-item-delete").click();
  await expect(page.getByTestId("module-menu")).toHaveCount(0);
}

test("to-dos: a deleted group comes back with its to-dos; a to-do whose group went after it can't come back alone", async () => {
  const { app, page } = await launch();
  await openModule(page, TODOS);
  await expect.poll(() => inModule(app, TODOS, `!!${q("empty")}`).catch(() => false), { timeout: 15_000 }).toBe(true);
  await addInto(app, q("first-task"), "Find the Ancient Crypt");
  await addInto(app, q("group-name-new"), "Bosses");
  await expect.poll(() => groupNames(app)).toEqual(["To-Dos", "Bosses"]);
  for (const title of ["Defeat the Elder", "Defeat Count Geonor"]) await addInto(app, `${groupNamed("Bosses")}.querySelector("form")`, title);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat the Elder", "Defeat Count Geonor"]);
  await waitForShown(app, TODOS);

  // The group goes at once, with its to-dos; no question. Its menu entry no longer promises a dialog.
  await deleteGroup(app, page, "Bosses");
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect.poll(() => groupNames(app)).toEqual(["To-Dos"]);
  await expect.poll(() => toasts(app)).toEqual(["Deleted “Bosses”"]);
  await expect.poll(() => inModule(app, TODOS, `${q("toast-status")}?.textContent`)).toBe("Deleted “Bosses”");
  // The Undo button is a real, focusable button in the panel.
  expect(await inModule(app, TODOS, `${q("undo")}.tagName === "BUTTON" && ${q("undo")}.tabIndex >= 0`)).toBe(true);
  await inModule(app, TODOS, `${q("undo")}.click()`);
  await expect.poll(() => groupNames(app)).toEqual(["To-Dos", "Bosses"]);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat the Elder", "Defeat Count Geonor"]);

  // A to-do, then its group: each has its own toast. The to-do alone can't come back (its group is gone), the user
  // is told so; the group's own Undo brings the group back as it was when it went.
  await inModule(app, TODOS, `[...document.querySelectorAll('[data-done]')].find((el) => el.querySelector('[data-testid="task-title"]')?.textContent.trim() === "Defeat the Elder").querySelector('[data-testid="task-delete"]').click()`);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);
  await deleteGroup(app, page, "Bosses");
  await expect.poll(() => toasts(app)).toEqual(["Deleted “Defeat the Elder”", "Deleted “Bosses”"]);
  // The older toast sits behind the newer one until the stack is spread out (the pointer or the focus on it).
  await inModule(app, TODOS, `document.querySelector(".tavora-toast-layer").dispatchEvent(new FocusEvent("focusin", { bubbles: true }))`);
  await expect.poll(() => inModule(app, TODOS, `[...document.querySelectorAll(".tavora-toast-slot")].every((slot) => !slot.inert)`)).toBe(true);
  await inModule(app, TODOS, `[...document.querySelectorAll('[data-testid="undo-toast"]')].find((el) => el.innerText.includes("Defeat the Elder")).querySelector('[data-testid="undo"]').click()`);
  await expect.poll(() => inModule(app, TODOS, `!!${q("undo-gone")}`)).toBe(true);
  await expect.poll(() => groupNames(app)).toEqual(["To-Dos"]);
  // Ctrl+Z (outside a text field) takes back the newest open delete: the group.
  await inModule(app, TODOS, `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }))`);
  await expect.poll(() => groupNames(app)).toEqual(["To-Dos", "Bosses"]);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);
  await app.close();
});
