// PoE 2 Builds shows tree jewels: their art in the Tree's sockets with the host item tooltip on hover,
// and a Jewels section in Gear. Live sources, so each test needs its address set.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { inModule, launch, waitForShown } from "./harness";

const ID = "wellbrained.poe2-builds";
const modules = path.resolve(import.meta.dirname, "../../../../modules");
const TREE = 0, GEAR = 1;

async function openPanels(page: Page, app: ElectronApplication) {
  for (const [i, type] of ["tree", "gear"].entries()) {
    await page.getByTestId("add-module").click();
    await page.getByTestId("panel-menu-toggle-" + ID).click();
    await page.getByTestId("open-" + ID + "-" + type).click();
    if (i === 0) { await page.getByTestId("grant-allow").click(); await expect(page.getByTestId("grant-dialog")).toHaveCount(0); }
    await page.getByTestId("add-module-dialog").getByRole("button", { name: "Close", exact: true }).click();
  }
  await waitForShown(app, ID);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1800, 1100));
}
/** Sends real input to a panel, as a player's mouse or keyboard would. */
async function input(app: ElectronApplication, index: number, event: Record<string, unknown>) {
  await app.evaluate(({ webContents }, { id, index, event }) => {
    const wc = webContents.getAllWebContents().filter((w) => w.getURL().startsWith(`tavora-module://${id}/`)).sort((a, b) => a.id - b.id)[index]!;
    wc.sendInputEvent(event as never);
  }, { id: ID, index, event });
}
async function tooltip(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("data:text/html")); return w ? { visible: w.isVisible() } : null; });
}
async function shot(app: ElectronApplication, index: number, file: string) {
  const image = await app.evaluate(async ({ webContents }, { id, index }) => (await webContents.getAllWebContents().filter((w) => w.getURL().startsWith(`tavora-module://${id}/`)).sort((a, b) => a.id - b.id)[index]!.capturePage()).toPNG().toString("base64"), { id: ID, index });
  await writeFile(file, Buffer.from(image, "base64"));
}
async function tooltipShot(app: ElectronApplication, file: string) {
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("data:text/html"))!.webContents.capturePage()).toPNG().toString("base64"));
  await writeFile(file, Buffer.from(image, "base64"));
}
/** Where the Tree drew jewel art, read by watching its canvas draw once more. */
async function jewelPoints(app: ElectronApplication): Promise<{ x: number; y: number }[]> {
  await inModule(app, ID, "window.__jewels=[];if(!window.__watching){window.__watching=true;const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...a){if(this.canvas.closest('.main-tree')&&a.length===4&&/\\/assets\\/items\\//.test(image.src||''))window.__jewels.push({x:a[0]+a[2]/2,y:a[1]+a[3]/2});return draw.call(this,image,...a);};}document.querySelector('#fit').click()", TREE);
  await expect.poll(() => inModule<number>(app, ID, "window.__jewels.length", TREE)).toBeGreaterThan(0);
  return inModule(app, ID, "(()=>{const r=document.querySelector('.main-tree canvas').getBoundingClientRect();return window.__jewels.filter(p=>p.x>0&&p.y>70&&p.x<r.width&&p.y<r.height-60).map(p=>({x:Math.round(r.left+p.x),y:Math.round(r.top+p.y)}));})()", TREE);
}
async function checkJewels(app: ElectronApplication, page: Page, name: string, outputPath: (file: string) => string) {
  const points = await jewelPoints(app);
  expect(points.length).toBeGreaterThan(0);
  // Neighbouring nodes can sit closer to the pointer at this zoom, so try each jewel until one answers.
  let at: { x: number; y: number } | undefined;
  for (const point of points) {
    await input(app, TREE, { type: "mouseMove", x: point.x, y: point.y });
    await page.waitForTimeout(400);
    if ((await tooltip(app))?.visible) { at = point; break; }
  }
  if (!at) await shot(app, TREE, outputPath(`${name}-missed.png`));
  expect(at, JSON.stringify(points)).toBeTruthy();
  await tooltipShot(app, outputPath(`${name}-tooltip.png`));
  await shot(app, TREE, outputPath(`${name}-tree.png`));
  // A click pins it; Escape closes it.
  at = at!;
  await input(app, TREE, { type: "mouseDown", button: "left", clickCount: 1, x: at.x, y: at.y });
  await input(app, TREE, { type: "mouseUp", button: "left", clickCount: 1, x: at.x, y: at.y });
  await input(app, TREE, { type: "mouseMove", x: at.x + 300, y: at.y });
  await page.waitForTimeout(300);
  expect((await tooltip(app))?.visible).toBe(true);
  await input(app, TREE, { type: "keyDown", keyCode: "Escape" });
  await expect.poll(async () => (await tooltip(app))?.visible).toBe(false);

  const gear = await inModule<string>(app, ID, "document.querySelector('#equipment-list').innerText", GEAR);
  expect(gear).toContain("Jewels");
  expect(gear).toContain("Jewel 1");
  await inModule(app, ID, "document.querySelector('.gear-group-heading').scrollIntoView()", GEAR);
  await expect.poll(() => inModule(app, ID, "[...document.querySelectorAll('.gear-group-heading ~ .gear-row img')].every(i=>i.complete&&i.naturalWidth)", GEAR)).toBe(true);
  await shot(app, GEAR, outputPath(`${name}-gear.png`));

  await page.getByTestId("rail-settings").click();
  await page.getByTestId("language-picker").click();
  await page.getByTestId("language-option-de").click();
  await page.getByTestId("settings-close").click();
  await expect.poll(() => inModule<string>(app, ID, "document.querySelector('#equipment-list').innerText", GEAR)).toContain("Juwelen");
  await page.waitForTimeout(500);
  await inModule(app, ID, "document.querySelector('.gear-group-heading').scrollIntoView()", GEAR);
  await shot(app, GEAR, outputPath(`${name}-gear-de.png`));
  await input(app, TREE, { type: "mouseMove", x: at.x, y: at.y + 1 });
  await expect.poll(async () => (await tooltip(app))?.visible).toBe(true);
  await tooltipShot(app, outputPath(`${name}-tooltip-de.png`));
}

test("a Mobalytics guide's jewels show in Tree and Gear", async ({}, info) => {
  test.skip(!process.env.POE2_JEWELS_GUIDE_URL, "Set a public Mobalytics guide URL whose last variant has jewels");
  test.setTimeout(150_000);
  const { app, page } = await launch(undefined, [modules]);
  try {
    await openPanels(page, app);
    await inModule(app, ID, "document.querySelector('.add-build').click();document.querySelector('#import-build').click()", TREE);
    await inModule(app, ID, `document.querySelector('#guide-url').value=${JSON.stringify(process.env.POE2_JEWELS_GUIDE_URL)};document.querySelector('#guide-read').click()`, TREE);
    await expect.poll(() => inModule(app, ID, "document.querySelector('#guide-preview').hidden", TREE), { timeout: 60_000 }).toBe(false);
    await inModule(app, ID, "document.querySelector('#guide-save').click()", TREE);
    await expect.poll(() => inModule(app, ID, "document.querySelector('#status').textContent", TREE)).toContain("Build saved");
    const id = await inModule<string>(app, ID, "document.querySelector('#build').value", TREE);
    await inModule(app, ID, `const b=document.querySelector('#build');b.value=${JSON.stringify(id)};b.dispatchEvent(new Event('change'))`, GEAR);
    // The last variant holds the guide's jewels.
    for (const index of [TREE, GEAR]) {
      await expect.poll(() => inModule(app, ID, `document.querySelector('#build')?.value===${JSON.stringify(id)}&&!!document.querySelector('#variant')`, index)).toBe(true);
      const last = await inModule<string>(app, ID, "(()=>{const v=document.querySelector('#variant');v.value=v.options[v.options.length-1].value;v.dispatchEvent(new Event('change'));return v.value;})()", index);
      await expect.poll(() => inModule(app, ID, "document.querySelector('#variant').value", index)).toBe(last);
    }
    await checkJewels(app, page, "guide", (f) => info.outputPath(f));
  } finally {
    await app.close();
  }
});

test("a poe.ninja character's jewels show in Tree and Gear", async ({}, info) => {
  test.skip(!process.env.POE2_JEWELS_CHARACTER_URL, "Set a public poe.ninja character URL with socketed jewels");
  test.setTimeout(150_000);
  const { app, page } = await launch(undefined, [modules]);
  try {
    await openPanels(page, app);
    await inModule(app, ID, "document.querySelector('.add-build').click();document.querySelector('#import-character').click()", TREE);
    await inModule(app, ID, `document.querySelector('#character-input').value=${JSON.stringify(process.env.POE2_JEWELS_CHARACTER_URL)};document.querySelector('#character-read').click()`, TREE);
    await expect.poll(() => inModule(app, ID, "document.querySelector('#character-preview').hidden", TREE), { timeout: 60_000 }).toBe(false);
    await inModule(app, ID, "document.querySelector('#character-save').click()", TREE);
    await expect.poll(() => inModule(app, ID, "document.querySelector('#status').textContent", TREE)).toContain("Character saved");
    const id = await inModule<string>(app, ID, "document.querySelector('#build').value", TREE);
    await inModule(app, ID, `const b=document.querySelector('#build');b.value=${JSON.stringify(id)};b.dispatchEvent(new Event('change'))`, GEAR);
    await expect.poll(() => inModule(app, ID, "!!document.querySelector('#equipment-list')", GEAR)).toBe(true);
    await checkJewels(app, page, "character", (f) => info.outputPath(f));
  } finally {
    await app.close();
  }
});
