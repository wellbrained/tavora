import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { expectModuleText, inModule, launch, NOTES, openGame, openModule, panels, PLAYGROUND, RAIL_WIDTH, setContentSize, TODOS, typeInModule, VUE, waitForShown } from "./harness";

// The official Notes, To-Dos and UI Playground modules, driven through their own pages.

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

test("official modules are marked Official, the examples Example", async () => {
  const { app, page } = await launch();
  await page.getByTestId("add-module").click();
  await expect(page.getByTestId(`provenance-${NOTES}`)).toHaveText("Official");
  await expect(page.getByTestId(`provenance-${TODOS}`)).toHaveText("Official");
  await expect(page.getByTestId(`provenance-${PLAYGROUND}`)).toHaveText("Official");
  await expect(page.getByTestId(`provenance-${VUE}`)).toHaveText("Example");
  await app.close();
});

test("the example modules are listed under Development, the playground with the official modules", async () => {
  const { app, page } = await launch();
  await page.getByTestId("add-module").click();
  const development = page.getByRole("region", { name: "Development" });
  await expect(development.getByTestId(`module-${VUE}`)).toBeVisible();
  await expect(development.getByTestId(`module-${PLAYGROUND}`)).toHaveCount(0);
  await expect(development.getByTestId(`module-${NOTES}`)).toHaveCount(0);
  await page.getByTestId("module-category-official").click();
  await expect(page.getByTestId(`module-${NOTES}`)).toBeVisible();
  await expect(page.getByTestId(`module-${PLAYGROUND}`)).toBeVisible();
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
  // Notes stay in the order they were made: a new one comes last.
  await expect.poll(() => noteTitles(app)).toEqual(["Scratchpad", "Count Geonor", "Atlas plan"]);

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
  // Deleting needs no confirmation; an Undo notice shows instead.
  await expect.poll(() => inModule(app, NOTES, `!!${q("undo-toast")}`, 0)).toBe(true);
  await expect.poll(() => noteTitles(app, 1)).toEqual(["Scratchpad"]);
  await expect.poll(() => editorText(app, 1)).toBe("Shared between panels");
  await app.close();
});

test("notes: a pasted picture is stored by the host, shown, resized and removed", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, NOTES);
  await ready(app, NOTES, "editor");
  await inModule(app, NOTES, `${q("editor")}.focus()`);

  // A 2000 x 1000 picture is pasted like a screenshot; Optimized shrinks it to 1600 wide.
  await inModule(
    app,
    NOTES,
    `(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1000;
      const context = canvas.getContext("2d");
      context.fillStyle = "#c00";
      context.fillRect(0, 0, 2000, 1000);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const data = new DataTransfer();
      data.items.add(new File([blob], "shot.png", { type: "image/png" }));
      ${q("editor")}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`,
  );
  const picture = `${q("editor")}.querySelector("img[data-blob-id]")`;
  await expect
    .poll(() => inModule(app, NOTES, `(() => { const img = ${picture}; return !!img && img.complete && img.naturalWidth; })()`), { timeout: 15_000 })
    .toBe(1600);
  expect(await inModule<string>(app, NOTES, `${picture}.src`)).toMatch(/^tavora-module:\/\/tavora\.notes\/_blobs\/[a-f0-9]{32}$/);

  // The host keeps the file in its own folder, named by id, as a WebP.
  const stored = await readdir(path.join(userData, "module-blobs", "official", NOTES), { recursive: true });
  expect(stored.filter((name) => /^[a-f0-9]{32}\.webp$/.test(path.basename(name)))).toHaveLength(1);

  // Selecting it shows the bar; Small puts it on its own line at a quarter of the width.
  await inModule(
    app,
    NOTES,
    `(() => { const img = ${picture}; const box = img.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }; for (const type of ["mousedown", "mouseup", "click"]) img.dispatchEvent(new MouseEvent(type, at)); })()`,
  );
  await expect.poll(() => inModule(app, NOTES, `!!${q("image-bar")}`)).toBe(true);
  await click(app, NOTES, `[data-testid="image-small"]`);
  await expect.poll(() => inModule(app, NOTES, `${q("editor")}.querySelector(".note-image").style.width`)).toBe("25%");

  // Left lets the text flow around it and keeps its size; Small puts it back on its own line.
  await click(app, NOTES, `[data-testid="image-left"]`);
  await expect.poll(() => inModule(app, NOTES, `(() => { const el = ${q("editor")}.querySelector(".note-image"); return el.dataset.mode + " " + getComputedStyle(el).float + " " + el.style.width; })()`)).toBe("left left 25%");
  await click(app, NOTES, `[data-testid="image-small"]`);
  await expect.poll(() => inModule(app, NOTES, `${q("editor")}.querySelector(".note-image").dataset.mode`)).toBe("block");

  // Open larger shows it big; Escape closes that and leaves the picture selected.
  await click(app, NOTES, `[data-testid="image-open"]`);
  await expect.poll(() => inModule(app, NOTES, `!!${q("image-lightbox")}`)).toBe(true);
  await inModule(app, NOTES, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await expect.poll(() => inModule(app, NOTES, `!${q("image-lightbox")}`)).toBe(true);

  expect(await inModule(app, NOTES, `!!${q("image-bar")}`)).toBe(true);
  // Removing it takes it out of the note.
  await click(app, NOTES, `[data-testid="image-remove"]`);
  await expect.poll(() => inModule(app, NOTES, `!${picture}`)).toBe(true);

  // Something that is not a picture is refused with a message and nothing is stored.
  await inModule(
    app,
    NOTES,
    `(() => {
      const data = new DataTransfer();
      data.items.add(new File(["BM not really"], "old.bmp", { type: "image/bmp" }));
      ${q("editor")}.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`,
  );
  await expect.poll(() => inModule(app, NOTES, `${q("undo-toast")}?.innerText ?? ""`)).toContain("not a PNG, JPEG, GIF or WebP");
  await app.close();
});

test("to-dos: groups, sub-to-dos, editing in place, objectives and finished tasks, kept after a restart", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, TODOS);
  await ready(app, TODOS, "empty");

  // The first to-do creates a group for itself.
  await addInto(app, TODOS, $(`[data-testid="first-task"]`), "Find the Ancient Crypt");
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt"]);
  await expect.poll(() => inModule(app, TODOS, `${q("group-name")}.textContent.trim()`)).toBe("To-Dos");

  await addInto(app, TODOS, $(`[data-testid="group-name-new"]`), "Bosses");
  await expect.poll(() => inModule(app, TODOS, `!!${groupNamed("Bosses")}`)).toBe(true);
  for (const title of ["Defeat Count Geonor", "Defeat the Executioner"]) {
    await addInto(app, TODOS, `${groupNamed("Bosses")}.querySelector("form")`, title);
  }
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor", "Defeat the Executioner"]);

  // Clicking a group's header row collapses and expands it; double-clicking its name renames it.
  const bossesHeader = `${groupNamed("Bosses")}.querySelector('[data-testid="group-header"]')`;
  await inModule(app, TODOS, `${bossesHeader}.click()`);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt"]);
  await inModule(app, TODOS, `${bossesHeader}.click()`);
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor", "Defeat the Executioner"]);
  await inModule(
    app,
    TODOS,
    `(() => {
      const name = ${groupNamed("Bosses")}.querySelector('[data-testid="group-name"]');
      name.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      name.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
      name.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    })()`,
  );
  await expect.poll(() => inModule(app, TODOS, `!!${q("group-name-input")}`)).toBe(true);
  await inModule(app, TODOS, `${q("group-name-input")}.blur()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor", "Defeat the Executioner"]);

  // Tab in a group's add row makes the next to-dos sub-to-dos of the last one.
  await inModule(
    app,
    TODOS,
    `${groupNamed("Bosses")}.querySelector("form input").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))`,
  );
  for (const title of ["Reach level 30", "Get cold resistance"]) {
    await addInto(app, TODOS, `${groupNamed("Bosses")}.querySelector("form")`, title);
  }
  await expect.poll(() => inModule(app, TODOS, `${taskTitled("Get cold resistance")}?.dataset.depth`)).toBe("1");
  await inModule(app, TODOS, `${taskTitled("Reach level 30")}.querySelector('[data-testid="task-done"]').click()`);
  await expectModuleText(app, TODOS, "task-children", "1/2");

  // A to-do's title is edited in place, at the row's own height; Enter saves.
  const crypt = taskTitled("Find the Ancient Crypt");
  const height = await inModule<number>(app, TODOS, `${crypt}.offsetHeight`);
  await inModule(app, TODOS, `${crypt}.querySelector('[data-testid="task-open"]').click()`);
  await expect.poll(() => inModule(app, TODOS, `document.activeElement === ${q("task-title-input")}`)).toBe(true);
  expect(await inModule<number>(app, TODOS, `${q("task-title-input")}.closest("[data-task-row]").offsetHeight`)).toBe(height);
  await inModule(
    app,
    TODOS,
    `(() => {
      const input = ${q("task-title-input")};
      input.value = "Find the Ancient Crypt again";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    })()`,
  );
  await expect.poll(() => taskTitles(app)).toContain("Find the Ancient Crypt again");
  await inModule(app, TODOS, `${taskTitled("Find the Ancient Crypt again")}.querySelector('[data-testid="task-open"]').click()`);
  await expect.poll(() => inModule(app, TODOS, `!!${q("task-title-input")}`)).toBe(true);
  await inModule(
    app,
    TODOS,
    `(() => {
      const input = ${q("task-title-input")};
      input.value = "Find the Ancient Crypt";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    })()`,
  );
  await expect.poll(() => taskTitles(app)).toContain("Find the Ancient Crypt");

  // The description is written in a popover from the to-do's menu; Ctrl+Enter saves.
  await pickFromMenu(app, TODOS, `${crypt}.querySelector('[data-testid="task-menu"]')`, "menu-description");
  await expect.poll(() => inModule(app, TODOS, `document.activeElement === ${q("description-input")}`)).toBe(true);
  await inModule(
    app,
    TODOS,
    `(() => {
      const input = ${q("description-input")};
      input.value = "Behind the waterfall";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    })()`,
  );
  await expectModuleText(app, TODOS, "task-details-preview", "Behind the waterfall");

  // Pinned tasks show up as current objectives.
  for (const title of ["Find the Ancient Crypt", "Defeat Count Geonor"]) {
    await pickFromMenu(app, TODOS, `${taskTitled(title)}.querySelector('[data-testid="task-menu"]')`, "menu-pin");
  }
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);

  // Finishing a task un-pins it and offers to undo that.
  await inModule(app, TODOS, `${taskTitled("Defeat Count Geonor")}.querySelector('[data-testid="task-done"]').click()`);
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt"]);
  await click(app, TODOS, `[data-testid="undo"]`);
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);
  await inModule(app, TODOS, `${taskTitled("Defeat Count Geonor")}.querySelector('[data-testid="task-done"]').click()`);
  await expect.poll(() => taskTitles(app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt"]);

  // Whether finished tasks stay or vanish is this panel's setting in the toolbar.
  await pickFromMenu(app, TODOS, q("finished-mode"), "finished-vanish");
  await expect.poll(() => taskTitles(app)).not.toContain("Defeat Count Geonor");

  await app.close();
  const again = await launch(userData);
  await openGame(again.page, "poe2");
  await ready(again.app, TODOS, "todos-app");
  await expect.poll(() => taskTitles(again.app, `[data-testid="objectives"]`)).toEqual(["Find the Ancient Crypt"]);
  await expect.poll(() => taskTitles(again.app)).not.toContain("Defeat Count Geonor");
  await expect.poll(() => taskTitles(again.app)).not.toContain("Reach level 30");
  await pickFromMenu(again.app, TODOS, q("finished-mode"), "finished-stay");
  await expect.poll(() => taskTitles(again.app)).toContain("Defeat Count Geonor");
  await expectModuleText(again.app, TODOS, "task-children", "1/2");
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

test("ui playground: shows every section, filters them and disables the controls", async () => {
  const { app, page } = await launch();
  await openModule(page, PLAYGROUND);
  await ready(app, PLAYGROUND, "section-colours");
  const sections = () => inModule<string[]>(app, PLAYGROUND, `[...document.querySelectorAll('[data-testid^="section-"]')].map((el) => el.id)`);
  // The swatches show the host's theme, not only the built-in default (also: the panel is connected).
  await expect.poll(() => inModule(app, PLAYGROUND, `document.documentElement.style.getPropertyValue("--primary")`)).not.toBe("");

  // Each tab shows its own sections; Basics is open first.
  await expect.poll(sections).toEqual(["colours", "type"]);
  await inModule(app, PLAYGROUND, `${q("tab-display")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await expect.poll(sections).toEqual(["status", "progress", "notices", "empty", "expandable", "collapsible", "tabs", "lists", "navlist"]);

  await inModule(
    app,
    PLAYGROUND,
    `(() => { const input = ${q("filter")}; input.value = "slider"; input.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  );
  await expect.poll(sections).toEqual(["choices"]);

  await click(app, PLAYGROUND, `[data-testid="disable-all"]`);
  await expect.poll(() => inModule(app, PLAYGROUND, `[...${q("section-choices")}.querySelectorAll("button")].every((el) => el.disabled)`)).toBe(true);
  await app.close();
});

test("to-dos: an open menu stays open when a save comes back", async () => {
  const { app, page } = await launch();
  await openModule(page, TODOS);
  await openModule(page, TODOS);
  await ready(app, TODOS, "empty", 0);
  await ready(app, TODOS, "empty", 1);
  await addInto(app, TODOS, $(`[data-testid="first-task"]`), "Find the Ancient Crypt");
  await addInto(app, TODOS, $(`[data-testid="group-name-new"]`), "Bosses");
  await expect.poll(() => inModule(app, TODOS, `!!${groupNamed("Bosses")}`, 1)).toBe(true);

  // The to-do's menu with its "Move to group" submenu open.
  const menu = `document.querySelector('[data-slot="dropdown-menu-content"][data-state="open"]')`;
  const sub = `document.querySelector('[data-slot="dropdown-menu-sub-content"][data-state="open"]')`;
  const open = (index: number) => inModule<boolean>(app, TODOS, `!!${menu} && !!${sub}`, index);
  await inModule(app, TODOS, `${taskTitled("Find the Ancient Crypt")}.querySelector('[data-testid="task-menu"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await expect.poll(() => inModule(app, TODOS, `!!${menu} && ${menu}.getAnimations().length === 0`)).toBe(true);
  await inModule(
    app,
    TODOS,
    `(() => { const trigger = ${menu}.querySelector('[data-slot="dropdown-menu-sub-trigger"]'); trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); })()`,
  );
  await expect.poll(() => open(0)).toBe(true);

  // This panel saves a change while its menu is open...
  await addInto(app, TODOS, `${groupNamed("Bosses")}.querySelector("form")`, "Defeat Count Geonor");
  await expect.poll(() => taskTitles(app, "", 1)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor"]);
  await page.waitForTimeout(300);
  expect(await open(0)).toBe(true);

  // ...and so does the other panel.
  await addInto(app, TODOS, `${groupNamed("Bosses")}.querySelector("form")`, "Defeat the Executioner", 1);
  await expect.poll(() => taskTitles(app, "", 0)).toEqual(["Find the Ancient Crypt", "Defeat Count Geonor", "Defeat the Executioner"]);
  await page.waitForTimeout(300);
  expect(await open(0)).toBe(true);
  await app.close();
});

test("to-dos: a group gets a color from its menu, and keeps it after a restart", async () => {
  const { app, page, userData } = await launch();
  await openModule(page, TODOS);
  await ready(app, TODOS, "empty");
  await addInto(app, TODOS, $(`[data-testid="first-task"]`), "Find the Ancient Crypt");
  await expect.poll(() => taskTitles(app)).toEqual(["Find the Ancient Crypt"]);

  const header = `${q("group-header")}`;
  const tint = () => inModule<string | null>(app, TODOS, `${header}.getAttribute("data-tint")`);
  expect(await tint()).toBeNull();

  // Tavora draws a module's menu over the panel's place on screen, so the panel must be shown first.
  await waitForShown(app, TODOS);

  // The group's menu is drawn by Tavora above every panel (ui.showMenu). A script click opens nothing;
  // a real key press on the ⋯ button does, and Color is a submenu of it.
  await inModule(app, TODOS, `${q("group-menu")}.click()`);
  await page.waitForTimeout(300);
  await expect(page.getByTestId("module-menu")).toHaveCount(0);
  await inModule(app, TODOS, `${q("group-menu")}.focus()`);
  await typeInModule(app, TODOS, "\n");
  await expect(page.getByTestId("module-menu")).toBeVisible();
  await expect(page.getByTestId("module-menu-item-rename")).toBeVisible();
  await page.getByTestId("module-menu-sub-3").click();
  await page.getByTestId("module-menu-item-color:blue").click();
  await expect(page.getByTestId("module-menu")).toHaveCount(0);
  await expect.poll(tint).toBe("blue");
  expect(await inModule(app, TODOS, `getComputedStyle(${header}).backgroundColor !== getComputedStyle(${header}.closest("section")).backgroundColor`)).toBe(true);
  await app.close();

  // Saved with the group.
  const again = await launch(userData);
  await openModule(again.page, TODOS);
  await ready(again.app, TODOS, "group-header");
  await expect.poll(() => inModule<string | null>(again.app, TODOS, `${header}.getAttribute("data-tint")`)).toBe("blue");
  await again.app.close();
});

test("clipboard: a module copies a PNG only right after a key press, once, and only a real PNG", async () => {
  const { app, page } = await launch();
  await openModule(page, NOTES);
  await ready(app, NOTES, "editor");

  /** A real key press in the module's page, the way the user would make one. */
  const pressKey = () =>
    app.evaluate(
      async ({ webContents }, moduleId) => {
        const target = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`tavora-module://${moduleId}/`));
        if (!target) throw new Error("no panel");
        target.sendInputEvent({ type: "keyDown", keyCode: "Shift" });
        target.sendInputEvent({ type: "keyUp", keyCode: "Shift" });
      },
      NOTES,
    );
  const copy = (picture: "png" | "text") =>
    inModule<number>(
      app,
      NOTES,
      `(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 20;
        canvas.height = 20;
        canvas.getContext("2d").fillRect(0, 0, 20, 20);
        const body = ${picture === "png" ? `await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))` : `new Blob(["not a picture, only words"])`};
        const response = await fetch(new URL("/_clipboard/", location.href), { method: "POST", body });
        return response.status;
      })()`,
    );
  const clipboardTypes = () => app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((item) => item.types));
  // It is the PC's own clipboard: a picture copied before the run must not count as the module's.
  await app.evaluate(({ clipboard }) => clipboard.clear());

  // Without a key press the module is refused, and the clipboard is untouched.
  expect(await copy("png")).toBe(403);
  expect(await clipboardTypes()).not.toContain("image/png");

  // Right after one it works, and the press is used up.
  await pressKey();
  await expect.poll(() => copy("png")).toBe(200);
  expect(await clipboardTypes()).toContain("image/png");
  expect(await copy("png")).toBe(403);

  // Something that is not a PNG is turned away.
  await pressKey();
  await expect.poll(() => copy("text")).toBe(415);
  await app.close();
});

test("calculator: works out sums from keys and the keyboard, and keeps the last results after a restart", async () => {
  const CALCULATOR = "tavora.calculator";
  const { app, page, userData } = await launch();
  await openModule(page, CALCULATOR);
  await ready(app, CALCULATOR, "key-=");
  const text = (testId: string) => inModule<string>(app, CALCULATOR, `${q(testId)}.textContent.trim()`);
  const results = (running = app) =>
    inModule<string[]>(running, CALCULATOR, `[...document.querySelectorAll('[data-testid="history-item"] span:last-child')].map((el) => el.textContent)`);

  for (const key of ["1", "2", "*", "(", "3", "+", "4"]) await click(app, CALCULATOR, `[data-testid="key-${key}"]`);
  await expect.poll(() => text("display")).toBe("12×(3+4");
  await expect.poll(() => text("preview")).toBe("= 84");
  await click(app, CALCULATOR, `[data-testid="key-="]`);
  await expect.poll(() => text("display")).toBe("84");
  await expect.poll(() => results()).toEqual(["84"]);

  // x² works on the result, and big numbers show their thousands.
  await click(app, CALCULATOR, `[data-testid="key-square"]`);
  await expect.poll(() => text("display")).toBe("84²");
  await expect.poll(() => text("preview")).toBe("= 7,056");
  await click(app, CALCULATOR, `[data-testid="key-="]`);
  await expect.poll(() => results()).toEqual(["7,056", "84"]);

  // The keyboard works too, and a sum that can't be worked out says why.
  for (const key of ["/", "0", "Enter"]) await inModule(app, CALCULATOR, `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)} }))`);
  await expect.poll(() => text("preview")).toBe("Can't divide by 0");
  await expect.poll(() => results()).toEqual(["7,056", "84"]);

  await app.close();
  const again = await launch(userData);
  await openGame(again.page, "poe2");
  await expect(panels(again.page, CALCULATOR)).toHaveCount(1);
  await ready(again.app, CALCULATOR, "history-item");
  await expect.poll(() => results(again.app)).toEqual(["7,056", "84"]);
  await click(again.app, CALCULATOR, `[data-testid="clear-history"]`);
  // Clearing asks first.
  await click(again.app, CALCULATOR, `[data-testid="confirm-submit"]`);
  await expect.poll(() => results(again.app)).toEqual([]);

  // The toolbar switches to the Basic keypad and hides the history.
  const shown = (testId: string) => inModule<boolean>(again.app, CALCULATOR, `!!${q(testId)}`);
  await click(again.app, CALCULATOR, `[data-testid="mode-basic"]`);
  await expect.poll(() => shown("key-square")).toBe(false);
  await click(again.app, CALCULATOR, `[data-testid="toggle-history"]`);
  await expect.poll(() => shown("history")).toBe(false);
  await again.app.close();
});

test("calculator: keys keep a usable size and the history keeps room, whatever the panel's size", async () => {
  const CALCULATOR = "tavora.calculator";
  const { app, page } = await launch();
  await openModule(page, CALCULATOR);
  await ready(app, CALCULATOR, "key-=");
  // The height of the smallest and biggest key, whether any two keys overlap, and how tall the history is and
  // whether it stays clear of the keypad (it may sit below the fold, where the panel scrolls to it).
  const layout = () =>
    inModule<{ smallest: number; biggest: number; overlap: boolean; history: number; clear: boolean }>(
      app,
      CALCULATOR,
      `(() => {
        const keypad = ${q("keypad")}.getBoundingClientRect();
        const keys = [...${q("keypad")}.children].map((key) => key.getBoundingClientRect());
        const history = ${q("history")}.getBoundingClientRect();
        return {
          smallest: Math.round(Math.min(...keys.map((key) => key.height))),
          biggest: Math.round(Math.max(...keys.map((key) => key.height))),
          overlap: keys.some((a, i) => keys.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)),
          history: Math.round(history.height),
          clear: history.top >= keypad.bottom || history.left >= keypad.right,
        };
      })()`,
    );
  const fits = (history: number, biggest = Infinity) => async () => {
    const now = await layout();
    return now.smallest >= 32 && now.biggest <= biggest && !now.overlap && now.clear && now.history >= history;
  };

  // The smallest window: the panel is too narrow for the history beside the keypad and too short for both.
  await setContentSize(app, 640, 480);
  await expect.poll(fits(160)).toBe(true);
  // Wide but short: the history sits beside the keypad.
  await setContentSize(app, RAIL_WIDTH + 1000, 480);
  await expect.poll(fits(160)).toBe(true);
  // Narrow and tall: the keys stop growing and the history gets the rest.
  await setContentSize(app, 640, 1000);
  await expect.poll(fits(400, 56)).toBe(true);
  // Without the history, the Basic keypad fits the smallest window whole (Plus has a row more and may scroll there).
  await click(app, CALCULATOR, `[data-testid="toggle-history"]`);
  await click(app, CALCULATOR, `[data-testid="mode-basic"]`);
  await setContentSize(app, 640, 480);
  await expect.poll(() => inModule<boolean>(app, CALCULATOR, `${q("calculator-body")}.scrollHeight <= ${q("calculator-body")}.clientHeight`)).toBe(true);
  await app.close();
});
