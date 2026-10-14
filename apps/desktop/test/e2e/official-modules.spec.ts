import { expect, test, type ElectronApplication } from "@playwright/test";
import { expectModuleText, inModule, launch, NOTES, openGame, openModule, panels, TODOS, typeInModule, VUE } from "./harness";

// The official Notes and To-Dos modules, driven through their own pages.

const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;

async function click(app: ElectronApplication, moduleId: string, selector: string, index = 0) {
  await inModule(app, moduleId, `document.querySelector(${JSON.stringify(selector)}).click()`, index);
}

/** Opens a menu from its trigger (a JavaScript expression) and picks an item, the way the keyboard does. */
async function pickFromMenu(app: ElectronApplication, moduleId: string, trigger: string, item: string, index = 0) {
  await inModule(app, moduleId, `${trigger}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`, index);
  const menu = `document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"]')`;
  // Wait for the menu to finish opening; items ignore clicks until then.
  await expect
    .poll(() => inModule(app, moduleId, `!!${menu}?.querySelector('[data-testid="${item}"]') && ${menu}.getAnimations().length === 0`, index))
    .toBe(true);
  await inModule(app, moduleId, `${menu}.querySelector('[data-testid="${item}"]').click()`, index);
  await expect.poll(() => inModule(app, moduleId, `!${menu}`, index)).toBe(true);
}

/** Fills one of the add rows (a form, given as a JavaScript expression) and submits it. */
async function addInto(app: ElectronApplication, moduleId: string, formExpr: string, text: string, index = 0) {
  await inModule(
    app,
    moduleId,
    `(() => {
      const form = ${formExpr};
      const input = form.querySelector("input");
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
    })()`,
    index,
  );
}

/** Waits until the nth panel of a module has loaded and shows this element. */
async function ready(app: ElectronApplication, moduleId: string, testId: string, index = 0) {
  await expect.poll(() => inModule(app, moduleId, `!!${q(testId)}`, index).catch(() => false), { timeout: 15_000 }).toBe(true);
}

/** Starts a new note and waits until it is ready for typing. */
async function newNote(app: ElectronApplication, index = 0) {
  const count = await inModule<number>(app, NOTES, `document.querySelectorAll('[data-testid="note-title"]').length`, index);
  await click(app, NOTES, `[data-testid="new-note"]`, index);
  // Ready once the new note is listed, opened and has the cursor.
  await expect
    .poll(() =>
      inModule(
        app,
        NOTES,
        `document.querySelectorAll('[data-testid="note-title"]').length === ${count + 1} &&
         document.querySelector('[data-selected="true"]')?.dataset.testid === "note-" + ${q("note-editor")}.dataset.loaded &&
         document.activeElement === ${q("editor")}`,
        index,
      ),
    )
    .toBe(true);
}

const $ = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;

/** The To-Dos group with this name. */
const groupNamed = (name: string) =>
  `[...document.querySelectorAll('section[data-testid^="group-"]')].find((el) => el.querySelector('[data-testid="group-name"]')?.textContent.trim() === ${JSON.stringify(name)})`;

/** The To-Dos task with this title, open or closed. */
const taskTitled = (title: string) =>
  `[...document.querySelectorAll('[data-done]')].find((el) => (el.querySelector('[data-testid="task-title"]')?.textContent.trim() ?? el.querySelector('[data-testid="task-title-input"]')?.value) === ${JSON.stringify(title)})`;

/** The Notes list row with this title. */
const noteRow = (title: string) =>
  `[...document.querySelectorAll('[data-testid="note-title"]')].find((el) => el.textContent === ${JSON.stringify(title)}).closest('[data-selected]')`;

const noteTitles = (app: ElectronApplication, index = 0) =>
  inModule<string[]>(app, NOTES, `[...document.querySelectorAll('[data-testid="note-title"]')].map((el) => el.textContent)`, index);

const editorText = (app: ElectronApplication, index = 0) => inModule<string>(app, NOTES, `${q("editor")}.innerText`, index);

const taskTitles = (app: ElectronApplication, scope = "", index = 0) =>
  inModule<string[]>(
    app,
    TODOS,
    `[...document.querySelectorAll('${scope} [data-testid="task-title"]')].map((el) => el.textContent.trim())`,
    index,
  );

test("official modules are marked Official, other installed modules Local", async () => {
  const { app, page } = await launch();
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId(`provenance-${NOTES}`)).toHaveText("Official");
  await expect(page.getByTestId(`provenance-${TODOS}`)).toHaveText("Official");
  await expect(page.getByTestId(`provenance-${VUE}`)).toHaveText("Local");
  await app.close();
});

test("notes: write, pin and search notes, and find them again after a restart", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, NOTES);
  await expect(panels(page, NOTES)).toHaveCount(1);
  await ready(app, NOTES, "editor");
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad"]);

  // The scratchpad is open from the start and saves as you type.
  await inModule(app, NOTES, `${q("editor")}.focus()`);
  await typeInModule(app, NOTES, "Buy a Greater Jeweller's Orb");
  await expect.poll(() => inModule(app, NOTES, `${q("save-state")}.dataset.state`)).toBe("saved");

  // A new note takes its title from the first line.
  await newNote(app);
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad", "Untitled note"]);
  await typeInModule(app, NOTES, "Count Geonor\nUse fire resistance flasks");
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad", "Count Geonor"]);
  await expect.poll(() => inModule(app, NOTES, `${q("save-state")}.dataset.state`)).toBe("saved");

  await newNote(app);
  await typeInModule(app, NOTES, "Atlas plan");
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad", "Atlas plan", "Count Geonor"]);

  // Pinned notes come before the others.
  await inModule(app, NOTES, `${noteRow("Count Geonor")}.querySelector("button").click()`);
  await expect.poll(() => editorText(app)).toContain("Use fire resistance flasks");
  await click(app, NOTES, `[data-testid="toggle-pin"]`);
  await expect.poll(() => inModule(app, NOTES, `${q("pinned")}?.innerText ?? ""`)).toContain("Count Geonor");
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad", "Count Geonor", "Atlas plan"]);

  // Search looks through titles and text.
  await inModule(
    app,
    NOTES,
    `(() => { const input = ${q("search")}; input.value = "FIRE flasks"; input.dispatchEvent(new Event("input")); })()`,
  );
  await expect.poll(() => noteTitles(app)).toEqual(["Count Geonor"]);
  await inModule(app, NOTES, `(() => { const input = ${q("search")}; input.value = "nothing like this"; input.dispatchEvent(new Event("input")); })()`);
  await expectModuleText(app, NOTES, "no-results", `No notes match "nothing like this".`);

  // Notes belong to their game.
  await openGame(page, "satisfactory");
  await openModule(page, NOTES);
  await ready(app, NOTES, "editor");
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad"]);

  await app.close();
  const again = await launch(userData);
  await openGame(again.page, "poe2");
  await expect(panels(again.page, NOTES)).toHaveCount(1);
  await ready(again.app, NOTES, "editor");
  await expect.poll(() => noteTitles(again.app)).toEqual(["Scratchpad", "Count Geonor", "Atlas plan"]);
  // The panel reopens on the note it showed.
  await expect.poll(() => editorText(again.app)).toContain("Count Geonor");
  await inModule(again.app, NOTES, `${noteRow("Scratchpad")}.querySelector("button").click()`);
  await expect.poll(() => editorText(again.app)).toBe("Buy a Greater Jeweller's Orb");
  await again.app.close();
});

test("notes: two panels show the same notes and follow each other's changes", async () => {
  const { app, page } = await launch();
  await openModule(page, NOTES);
  await openModule(page, NOTES);
  await expect(panels(page, NOTES)).toHaveCount(2);
  await ready(app, NOTES, "editor", 0);
  await ready(app, NOTES, "editor", 1);
  await expect.poll(() => noteTitles(app, 1)).toEqual(["Scratchpad"]);

  await inModule(app, NOTES, `${q("editor")}.focus()`, 0);
  await typeInModule(app, NOTES, "Shared between panels", 0);
  await expect.poll(() => editorText(app, 1)).toBe("Shared between panels");

  await newNote(app, 1);
  await typeInModule(app, NOTES, "Made in the second panel", 1);
  await expect.poll(() => noteTitles(app, 0)).toEqual(["Scratchpad", "Made in the second panel"]);

  // Deleting asks first, then removes the note everywhere.
  await pickFromMenu(app, NOTES, `${noteRow("Made in the second panel")}.querySelector('[data-testid="note-menu"]')`, "menu-delete", 0);
  await expect.poll(() => inModule(app, NOTES, `!!${q("confirm")}`, 0)).toBe(true);
  await click(app, NOTES, `[data-testid="confirm-submit"]`, 0);
  await expect.poll(() => noteTitles(app, 1)).toEqual(["Scratchpad"]);
  await expect.poll(() => editorText(app, 1)).toBe("Shared between panels");
  await app.close();
});

test("to-dos: groups, steps, objectives and finished tasks, kept after a restart", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, TODOS);
  await ready(app, TODOS, "empty");

  // The first to-do creates a group for itself.
  await addInto(app, TODOS, $(`[data-testid="first-task"]`), "Find the Ancient Crypt");
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt"]);
  await expect.poll(() => inModule(app, TODOS, `${q("group-name")}.textContent.trim()`)).toBe("To-Dos");

  await click(app, TODOS, `[data-testid="new-group"]`);
  await addInto(app, TODOS, $(`[data-testid="group-name-new"]`), "Bosses");
  await expect.poll(() => inModule(app, TODOS, `!!${groupNamed("Bosses")}`)).toBe(true);
  for (const title of ["Defeat Count Geonor", "Defeat the Executioner"]) {
    await addInto(app, TODOS, `${groupNamed("Bosses")}.querySelector("form")`, title);
  }
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor", "Defeat the Executioner"]);

  // Steps are added inside a task's details.
  await inModule(app, TODOS, `${taskTitled("Defeat the Executioner")}.querySelector('[data-testid="task-open"]').click()`);
  await expect.poll(() => inModule(app, TODOS, `!!${q("task-details")}`)).toBe(true);
  for (const step of ["Reach level 30", "Get cold resistance"]) {
    await addInto(app, TODOS, $(`[data-testid="task-details"] form`), step);
  }
  await expect.poll(() => inModule(app, TODOS, `${q("steps")}.querySelectorAll("li").length`)).toBe(2);
  await inModule(app, TODOS, `${q("steps")}.querySelector('[data-testid="step-done"]').click()`);
  await click(app, TODOS, `[data-testid="task-close"]`);
  await expectModuleText(app, TODOS, "task-steps", "1/2 steps");

  // Pinned tasks show up as current objectives.
  for (const title of ["Find the Ancient Crypt", "Defeat Count Geonor"]) {
    await pickFromMenu(app, TODOS, `${taskTitled(title)}.querySelector('[data-testid="task-menu"]')`, "menu-pin");
  }
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);

  // Finishing a task un-pins it; hiding finished tasks is this panel's choice.
  await inModule(app, TODOS, `${taskTitled("Defeat Count Geonor")}.querySelector('[data-testid="task-done"]').click()`);
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt"]);
  await click(app, TODOS, `[data-testid="toggle-done"]`);
  await expect.poll(() => taskTitles(app)).not.toContain("Defeat Count Geonor");

  await app.close();
  const again = await launch(userData);
  await openGame(again.page, "poe2");
  await ready(again.app, TODOS, "todos-app");
  await expect.poll(() => taskTitles(again.app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt"]);
  await expect.poll(() => taskTitles(again.app)).not.toContain("Defeat Count Geonor");
  await click(again.app, TODOS, `[data-testid="toggle-done"]`);
  await expect.poll(() => taskTitles(again.app)).toContain("Defeat Count Geonor");
  await expectModuleText(again.app, TODOS, "task-steps", "1/2 steps");
  await again.app.close();
});

test("to-dos: two panels share one list and both keep their changes", async () => {
  const { app, page } = await launch();
  await openModule(page, TODOS);
  await openModule(page, TODOS);
  await expect(panels(page, TODOS)).toHaveCount(2);
  await ready(app, TODOS, "empty", 0);
  await ready(app, TODOS, "empty", 1);

  await addInto(app, TODOS, $(`[data-testid="first-task"]`), "From the first panel", 0);
  await expect.poll(() => taskTitles(app, "", 1)).toEqual(["From the first panel"]);

  // Both panels add at once: neither change is lost.
  await Promise.all([
    addInto(app, TODOS, $(`form[data-testid^="add-task-"]`), "Second from panel one", 0),
    addInto(app, TODOS, $(`form[data-testid^="add-task-"]`), "Second from panel two", 1),
  ]);
  for (const index of [0, 1]) {
    await expect
      .poll(async () => (await taskTitles(app, "", index)).sort())
      .toEqual(["From the first panel", "Second from panel one", "Second from panel two"]);
  }
  await app.close();
});
