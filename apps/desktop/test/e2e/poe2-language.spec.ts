// PoE 2 Builds shows its own texts in Tavora's language and switches them live.
// Game names (items, gems, classes) stay English in every language.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { inModule, launch, waitForShown } from "./harness";

const ID = "wellbrained.poe2-builds";
const modules = path.resolve(import.meta.dirname, "../../../../modules");
const xml = `<PathOfBuilding2><Build className="Ranger" ascendClassName="Deadeye" level="80"/><Items activeItemSet="1"><Item id="1">Rarity: RARE
Test Bow
Obliterator Bow
Item Level: 80
Quality: 20
LevelReq: 78
Implicits: 0
Adds 10 to 22 Physical Damage
</Item><ItemSet id="1"><Slot name="Weapon 1" itemId="1"/></ItemSet></Items><Skills activeSkillSet="1"><SkillSet id="1"><Skill><Gem nameSpec="Ice Shot" gemId="Metadata/Items/Gems/SkillGemIceShot" level="18" quality="20"/></Skill></SkillSet></Skills><Tree activeSpec="1"><Spec nodes="97" treeVersion="0_5"/></Tree></PathOfBuilding2>`;

/** Runs a script in every PoE 2 Builds panel; the result tells which panel answered. */
async function inPanels<T>(app: ElectronApplication, script: string): Promise<T[]> {
  const count = await app.evaluate(({ webContents }, id) => webContents.getAllWebContents().filter((w) => w.getURL().startsWith(`tavora-module://${id}/`)).length, ID);
  return Promise.all(Array.from({ length: count }, (_, i) => inModule<T>(app, ID, script, i)));
}
/** Saves a picture of each panel, as name-1.png, name-2.png and so on. */
async function shot(app: ElectronApplication, file: string) {
  const images = await app.evaluate(async ({ webContents }, id) => Promise.all(webContents.getAllWebContents().filter((w) => w.getURL().startsWith(`tavora-module://${id}/`)).map(async (w) => (await w.capturePage()).toPNG().toString("base64"))), ID);
  await Promise.all(images.map((image, i) => writeFile(file.replace(/\.png$/, `-${i + 1}.png`), Buffer.from(image, "base64"))));
}
async function pickLanguage(page: Page, value: string) {
  await page.getByTestId("rail-settings").click();
  await page.getByTestId("language-picker").click();
  await page.getByTestId(`language-option-${value}`).click();
  await page.getByTestId("settings-close").click();
}

test("PoE 2 Builds follows Tavora's language and keeps game names English", async ({}, info) => {
  const { app, page } = await launch(undefined, [modules], { locale: "de-DE" });
  try {
    await page.getByTestId("add-module").click();
    await page.getByTestId("panel-menu-toggle-" + ID).click();
    await page.getByTestId("open-" + ID + "-gear").click();
    await page.getByTestId("grant-allow").click();
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await page.getByTestId("add-module-dialog").getByRole("button", { name: "Schließen", exact: true }).click();
    await waitForShown(app, ID);

    await expect.poll(() => inModule(app, ID, "document.querySelector('.add-build').textContent")).toBe("Hinzufügen");
    expect(await inModule(app, ID, "document.querySelector('.empty p').textContent")).toContain("Importier einen Guide");
    expect(await inModule(app, ID, "Array.from(document.querySelectorAll('#add-actions .menu-label')).map(n=>n.textContent)")).toEqual(["Build importieren", "Charakter importieren", "Build-Datei laden"]);
    await inModule(app, ID, "document.querySelector('#add-actions').showPopover()");
    await shot(app, info.outputPath("de-add-menu.png"));
    await inModule(app, ID, "document.querySelector('#add-actions').hidePopover()");

    // The guide import dialog
    await inModule(app, ID, "document.querySelector('#import-build').click()");
    await expect.poll(() => inModule(app, ID, "document.querySelector('#guide-import-title')?.textContent")).toBe("Build importieren");
    await inModule(app, ID, "document.querySelector('#guide-read').click()");
    await expect.poll(() => inModule(app, ID, "document.querySelector('#guide-error').textContent")).toBe("Füg eine Guide-URL ein oder häng eine Build-Datei an.");
    await shot(app, info.outputPath("de-guide-import.png"));
    await inModule(app, ID, "document.querySelector('.guide-import').close()");

    // The character import dialog, with a preview
    await expect.poll(() => inModule(app, ID, "document.querySelectorAll('.character-import').length")).toBe(0);
    await inModule(app, ID, "document.querySelector('#import-character').click()");
    await inModule(app, ID, `document.querySelector('#character-source').value='code';document.querySelector('#character-source').dispatchEvent(new Event('change'));document.querySelector('#character-input').value=${JSON.stringify(xml)};document.querySelector('#character-read').click()`);
    await expect.poll(() => inModule(app, ID, "document.querySelector('#character-preview').hidden")).toBe(false);
    const summary = await inModule<string>(app, ID, "document.querySelector('#character-summary').textContent");
    expect(summary).toContain("Ranger · Deadeye · Stufe 80");
    expect(summary).toContain("1 ausgerüsteter Gegenstand");
    expect(summary).toContain("1 wählbares Setup");
    await shot(app, info.outputPath("de-character-import.png"));
    await inModule(app, ID, "document.querySelector('#character-name').value='Test character';document.querySelector('#character-save').click()");
    await expect.poll(() => inModule(app, ID, "document.querySelector('#status').textContent")).toContain("Charakter gespeichert");
    expect(await inModule(app, ID, "document.querySelector('#build optgroup').label")).toBe("Meine Charaktere");
    expect(await inModule(app, ID, "document.querySelector('#variant').selectedOptions[0].textContent")).toBe("Aktives Setup");

    // Gear in German, game names in English
    const gear = await inModule<string>(app, ID, "document.querySelector('.gear-content').innerText");
    expect(gear).toContain("Ausrüstungsliste");
    expect(gear).toContain("Test Bow");
    expect(gear).toContain("Adds 10 to 22 Physical Damage");
    expect(await inModule(app, ID, "document.querySelector('.character-summary').textContent")).toMatch(/^Ranger · Stufe 80 · Importiert am /);

    await inModule(app, ID, "document.querySelector('#build-actions').showPopover()");
    expect(await inModule(app, ID, "Array.from(document.querySelectorAll('#build-actions .menu-label')).map(n=>n.textContent)")).toEqual(["Charakter ansehen", "Charakter exportieren", "Alle Notizen einblenden", "Baum öffnen", "Skills öffnen", "Guide öffnen"]);
    await shot(app, info.outputPath("de-build-menu.png"));
    await inModule(app, ID, "document.querySelector('#build-actions').hidePopover()");

    // The other three panels
    for (const type of ["tree", "skills", "guide"]) {
      await page.getByTestId("add-module").click();
      await page.getByTestId("panel-menu-toggle-" + ID).click();
      await page.getByTestId("open-" + ID + "-" + type).click();
      await page.getByTestId("add-module-dialog").getByRole("button", { name: "Schließen", exact: true }).click();
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1100));
    const texts = async () => (await inPanels<string>(app, "document.body.innerText")).join("\n");
    await expect.poll(texts).toContain("Build-Infos");
    const german = await texts();
    for (const text of ["Punkte je Waffenset", "Gem-Stufe 18", "Ice Shot", "Build-Infos", "Alle zuklappen", "Ausrüstungsliste"]) expect(german).toContain(text);
    await shot(app, info.outputPath("de-panels.png"));

    // Switching live
    await pickLanguage(page, "en");
    await expect.poll(texts).toContain("Tree info");
    const english = await texts();
    for (const text of ["Weapon allocation", "Gem level 18", "Ice Shot", "Build information", "Collapse all", "Equipment list"]) expect(english).toContain(text);
    expect(english).not.toContain("Ausrüstungsliste");
    await shot(app, info.outputPath("en-panels.png"));
  } finally {
    await app.close();
  }
});
