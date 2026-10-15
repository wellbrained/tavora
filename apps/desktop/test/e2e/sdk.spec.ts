// Milestone B gate: every example module (vanilla, React, Vue) gets the same
// SDK behaviour from the host. Isolation and denied calls are covered in
// isolation.spec.ts, failure recovery in recovery.spec.ts.

import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  clickInModule,
  EXAMPLES,
  expectModuleText,
  inModule,
  launch,
  noteText,
  onWindow,
  openGame,
  openModule,
  panels,
  saveNote,
} from "./harness";

for (const { name, id } of EXAMPLES) {
  test(`${name}: documents are shared by a module's panels and survive a restart`, async () => {
    const { app, page, userData } = await launch();
    await openModule(page, id);
    await openModule(page, id);
    await expectModuleText(app, id, "status", "Connected", 0);
    await expectModuleText(app, id, "status", "Connected", 1);
    await expectModuleText(app, id, "game", "Path of Exile 2", 0);

    await saveNote(app, id, "Act 2: get the second ascendancy", 0);
    await expectModuleText(app, id, "note-status", "Saved", 0);
    await expectModuleText(app, id, "note-revision", "1", 0);

    // The other panel hears about the change and shows it.
    await expectModuleText(app, id, "note-status", "Updated in another panel", 1);
    await expectModuleText(app, id, "note-revision", "1", 1);
    expect(await noteText(app, id, 1)).toBe("Act 2: get the second ascendancy");

    // Editing on top of the latest revision works from either panel.
    await saveNote(app, id, "Act 3", 1);
    await expectModuleText(app, id, "note-revision", "2", 1);
    await expectModuleText(app, id, "note-revision", "2", 0);

    await app.close();
    const again = await launch(userData);
    await expectModuleText(again.app, id, "status", "Connected", 0);
    await expectModuleText(again.app, id, "note-revision", "2", 0);
    expect(await noteText(again.app, id, 0)).toBe("Act 3");
    await again.app.close();
  });

  test(`${name}: panel state belongs to one panel and is removed when it closes`, async () => {
    const { app, page, userData } = await launch();
    await openModule(page, id);
    await openModule(page, id);
    await expectModuleText(app, id, "status", "Connected", 1);

    await clickInModule(app, id, "view-grid", 0);
    await expectModuleText(app, id, "view", "grid", 0);
    await expectModuleText(app, id, "view", "list", 1);

    // The same panel gets its state back after a restart.
    await app.close();
    const again = await launch(userData);
    await expectModuleText(again.app, id, "status", "Connected", 1);
    await expectModuleText(again.app, id, "view", "grid", 0);
    await expectModuleText(again.app, id, "view", "list", 1);

    // Closing the panel deletes its state; a new panel starts fresh.
    const closed = (await panels(again.page, id).first().getAttribute("data-testid"))!.replace("panel-", "");
    await panels(again.page, id).first().getByTestId("close").click();
    await expect(panels(again.page, id)).toHaveCount(1);
    await expect
      .poll(async () => (await readdir(path.join(userData, "panel-state")).catch((): string[] => [])).includes(`${closed}.json`))
      .toBe(false);
    await openModule(again.page, id);
    await expectModuleText(again.app, id, "status", "Connected", 1);
    await expectModuleText(again.app, id, "view", "list", 1);
    await again.app.close();
  });
}

test("modules are suspended while the window is hidden and resumed when it is shown", async () => {
  const { app, page } = await launch();
  for (const { id } of EXAMPLES) await openModule(page, id);
  for (const { id } of EXAMPLES) await expectModuleText(app, id, "lifecycle", "active");

  await onWindow(app, "hide");
  for (const { id } of EXAMPLES) await expectModuleText(app, id, "lifecycle", "suspended");

  await onWindow(app, "show");
  for (const { id } of EXAMPLES) await expectModuleText(app, id, "lifecycle", "active");
  await app.close();
});

test("each module's documents are private to it and to the current game", async () => {
  const { app, page } = await launch();
  const [vanilla, react] = EXAMPLES;
  await openModule(page, vanilla.id);
  await openModule(page, react.id);
  await expectModuleText(app, react.id, "status", "Connected");
  await saveNote(app, vanilla.id, "only for vanilla in poe2");
  await expectModuleText(app, vanilla.id, "note-revision", "1");

  // Another module never sees it, not even as a change event.
  await expectModuleText(app, react.id, "note-revision", "0");
  await expectModuleText(app, react.id, "note-status", "");
  expect(await noteText(app, react.id)).toBe("");

  // The same module in another game starts empty.
  await openGame(page, "satisfactory");
  await openModule(page, vanilla.id);
  await expectModuleText(app, vanilla.id, "status", "Connected");
  await expect
    .poll(() => inModule<string>(app, vanilla.id, `document.querySelector('[data-testid="game"]').dataset.gameId`))
    .toBe("satisfactory");
  await expectModuleText(app, vanilla.id, "note-revision", "0");
  await app.close();
});

test("every module page starts from Tavora's look, and its own styles win", async () => {
  const { app, page } = await launch();
  for (const { id } of EXAMPLES) await openModule(page, id);
  for (const { id } of EXAMPLES) {
    await expectModuleText(app, id, "status", "Connected");
    const style = await inModule<string[]>(
      app,
      id,
      `(() => {
        const css = (selector, property) => getComputedStyle(document.querySelector(selector)).getPropertyValue(property).trim();
        return [
          css("body", "margin"),
          css(":root", "--tavora-primary"),
          css('[data-testid="save-note"]', "background-color"),
          css('[data-testid="note"]', "background-color"),
          css('[data-testid="increment"]', "background-color"),
          // Page height against panel height, so a failure says by how much.
          document.documentElement.scrollHeight + "<=" + innerHeight,
        ];
      })()`,
    );
    // No page margin or scrollbar, Tavora's tokens, dark controls, and the
    // module's own gold on its main button.
    const [height] = style.splice(5, 1) as [string];
    expect(style, id).toEqual(["0px", "#e0a243", "rgb(42, 37, 33)", "rgb(32, 28, 25)", "rgb(224, 162, 67)"]);
    const [pageHeight, panelHeight] = height.split("<=").map(Number) as [number, number];
    // A panel that is a background tab has no height to compare with; how many panels fit side by side
    // depends on the room and the text sizes of the machine.
    if (panelHeight > 0) expect(pageHeight, `${id}: page ${pageHeight}px in a panel ${panelHeight}px high`).toBeLessThanOrEqual(panelHeight);
  }
  await app.close();
});
