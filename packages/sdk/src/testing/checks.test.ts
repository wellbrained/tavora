// The layout and Tab checks must catch what they are for, in a real browser: pages with known faults, and pages without.
// They drive the system's Chrome or Edge headless through playwright-core (a dev dependency of this package only); where
// neither is installed the browser tests are skipped with a note.
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright-core";
import { checkFocus, checkLayout, inspectLayout, type TestPage } from "../testing.js";

async function launch(): Promise<Browser | null> {
  const tries: LaunchOptions[] = [{ channel: "chrome" }, { channel: "msedge" }, { channel: "chromium" }];
  if (process.env.TAVORA_TEST_BROWSER) tries.unshift({ executablePath: process.env.TAVORA_TEST_BROWSER });
  for (const path of ["/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (existsSync(path)) tries.push({ executablePath: path });
  for (const options of tries) {
    try {
      return await chromium.launch({ ...options, headless: true });
    } catch {
      // try the next one
    }
  }
  return null;
}

const browser = await launch();
if (!browser) console.warn("[checks.test] No Chrome, Edge or Chromium found: the browser checks are skipped (TAVORA_TEST_BROWSER=<executable> points at one).");

let page: Page;
beforeAll(async () => {
  if (browser) page = await browser.newPage({ viewport: { width: 400, height: 400 } });
});
afterAll(async () => {
  await browser?.close();
});

const html = (body: string, css = "") =>
  `<style>body{margin:0;font:14px sans-serif}#root{width:300px;height:300px;position:relative}:focus-visible{outline:2px solid blue}${css}</style><div id="root">${body}</div>`;

describe("inspectLayout without a browser", () => {
  it("is self-contained, so it can be sent to a page as text", () => {
    // Rebuilt from its text alone, it runs (here with no layout: jsdom-less Node has no document, so give it a tiny one).
    const rebuilt = new Function(`return (${inspectLayout.toString()})`)() as typeof inspectLayout;
    const fake = { querySelector: () => null };
    const scope = globalThis as { document?: unknown };
    const before = scope.document;
    scope.document = fake;
    try {
      expect(rebuilt("#missing")).toEqual([{ kind: "overflow", where: "#missing", detail: "the panel is not on the page" }]);
    } finally {
      scope.document = before;
    }
  });

  it("a Playwright page is a TestPage", () => {
    // Type-level: this compiles only if Playwright's Page fits.
    const fits = (one: Page): TestPage => one;
    expect(typeof fits).toBe("function");
  });
});

describe.skipIf(!browser)("checkLayout", () => {
  it("finds nothing on a clean page", async () => {
    await page.setContent(html(`<button>Fine</button><p title="x" style="width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">A long text that is cut, with a title to read it</p><input value="Short">`));
    expect(await checkLayout(page, "#root")).toEqual([]);
  });

  it("finds what sticks out, text under 12 px, cut-off text, an ellipsis without a title and a cut-off value", async () => {
    await page.setContent(
      html(`
      <div data-testid="wide" style="position:absolute;left:250px;width:120px">Sticks out</div>
      <span style="font-size:10px">Tiny</span>
      <div style="width:50px;overflow:hidden;white-space:nowrap">Cut off without any ellipsis at all</div>
      <div style="width:50px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Ellipsis and no title</div>
      <input value="A value that is much too long for this small field" style="width:60px">`),
    );
    const issues = await checkLayout(page, "#root");
    expect(issues).toContainEqual({ kind: "overflow", where: 'div[wide] "Sticks out"', detail: "extends 70px past the panel's edge" });
    expect(issues).toContainEqual({ kind: "small-text", where: 'span "Tiny"', detail: "10px text" });
    const clipped = issues.filter((one) => one.kind === "clipped").map((one) => one.detail);
    expect(clipped.some((detail) => detail.startsWith("text is"))).toBe(true);
    expect(clipped.some((detail) => detail.includes("no title"))).toBe(true);
    expect(clipped.some((detail) => detail.startsWith("the value is"))).toBe(true);
  });

  it("finds a page that scrolls sideways", async () => {
    await page.setContent(html(``, `body{width:900px}`));
    expect((await checkLayout(page, "#root")).map((one) => one.kind)).toEqual(["page-overflow"]);
  });

  it("leaves alone what is clipped by its container, drawn outside on purpose, or skipped", async () => {
    await page.setContent(
      html(`
      <div style="width:100px;overflow:hidden"><div style="width:400px">Clipped by its box</div></div>
      <div data-slot="dialog-content" style="position:absolute;left:200px;width:150px">A dialog</div>
      <div aria-hidden="true" style="font-size:8px">Decoration</div>
      <div class="mine" style="position:absolute;left:280px;width:100px">Mine</div>`),
    );
    expect(await checkLayout(page, "#root", { skip: ".mine, [aria-hidden=true]" })).toEqual([]);
  });

  it("accepts a line clamp with a title, and finds one without", async () => {
    const clamp = "width:80px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden";
    const text = "A name that is far too long for two short lines of this box";
    await page.setContent(html(`<p title="${text}" style="${clamp}">${text}</p>`));
    expect(await checkLayout(page, "#root")).toEqual([]);
    await page.setContent(html(`<p style="${clamp}">${text}</p>`));
    const issues = await checkLayout(page, "#root");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "clipped", where: `p "${text.slice(0, 40)}"` });
    expect(issues[0]!.detail).toMatch(/^shortened to fit its lines .* and no title/);
  });

  it("checks a dialog drawn outside the panel, against the window", async () => {
    const dialog = (body: string, style = "") => `${html(`<button>Behind</button>`)}<div role="dialog" data-state="open" style="position:fixed;top:20px;left:20px;width:200px;${style}">${body}</div>`;
    await page.setContent(dialog(`<button>Fine</button>`));
    expect(await checkLayout(page, "#root")).toEqual([]);
    await page.setContent(dialog(`<span style="font-size:9px">Tiny</span><div style="width:50px;overflow:hidden;white-space:nowrap">Cut off without any ellipsis</div>`, "left:300px"));
    const issues = await checkLayout(page, "#root");
    expect(issues).toContainEqual({ kind: "small-text", where: 'span "Tiny"', detail: "9px text" });
    expect(issues).toContainEqual({ kind: "overflow", where: 'div "TinyCut off without any ellipsis"', detail: "extends 100px past the window's edge" });
    expect(issues.some((one) => one.kind === "clipped" && one.detail.startsWith("text is"))).toBe(true);
    // Below the window counts too; `layers: ""` checks the panel only.
    await page.setContent(dialog(`<button>Low</button>`, "top:390px;height:40px"));
    expect(await checkLayout(page, "#root")).toContainEqual({ kind: "overflow", where: 'div "Low"', detail: "extends 30px past the window's top or bottom" });
    expect(await checkLayout(page, "#root", { layers: "" })).toEqual([]);
  });

  it("checks the kit's toasts, drawn at the end of the page", async () => {
    await page.setContent(`${html(`<button>Panel</button>`)}<div data-slot="toaster" style="position:fixed;bottom:8px;left:8px"><span style="font-size:10px">Saved</span><button>Undo</button></div>`);
    expect(await checkLayout(page, "#root")).toEqual([{ kind: "small-text", where: 'span "Saved"', detail: "10px text" }]);
    expect((await checkFocus(page, "#root", { settleMs: 0 })).stops).toEqual(['button "Panel"', 'button "Undo"']);
  });

  it("reads no order between the panel and a layer drawn over it", async () => {
    // Toasts float over the panel's bottom edge, over content that goes on below them; Tab reaches them after that content.
    const rows = Array.from({ length: 6 }, (_, index) => `<button style="display:block;height:50px">Row ${index + 1}</button>`).join("");
    await page.setContent(`${html(rows)}<div data-slot="toaster" style="position:fixed;top:200px;left:8px"><button>Undo</button></div>`);
    const { stops, issues } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(stops.at(-1)).toBe('button "Undo"');
    expect(issues).toEqual([]);
  });

  it("takes another smallest size", async () => {
    await page.setContent(html(`<span style="font-size:13px">Small for a game</span>`));
    expect(await checkLayout(page, "#root")).toEqual([]);
    expect((await checkLayout(page, "#root", { minFontSize: 14 })).map((one) => one.kind)).toEqual(["small-text"]);
  });

  it("says when the panel is not there", async () => {
    await page.setContent(html(``));
    expect(await checkLayout(page, "#nothing")).toEqual([{ kind: "overflow", where: "#nothing", detail: "the panel is not on the page" }]);
  });
});

describe.skipIf(!browser)("checkFocus", () => {
  it("accepts controls in reading order with a focus ring, a radio group counting as one stop", async () => {
    await page.setContent(html(`<button>One</button><div role="radiogroup"><input type="radio" name="a" checked aria-label="A"><input type="radio" name="a" aria-label="B"></div><button>Two</button>`));
    const result = await checkFocus(page, "#root", { settleMs: 0 });
    expect(result).toEqual({ stops: ['button "One"', "input[A]", 'button "Two"'], issues: [], complete: true });
  });

  it("leaves a control taken out of the Tab order on purpose (tabindex -1) alone", async () => {
    await page.setContent(html(`<button>Reached</button><div role="button" tabindex="-1">Skipped</div><button>Also reached</button>`));
    const { issues, stops } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(stops).toHaveLength(2);
    expect(issues).toEqual([]);
  });

  it("finds Tab going up the page", async () => {
    await page.setContent(html(`<div style="display:flex;flex-direction:column-reverse"><button>First in the page</button><button>Second</button></div>`));
    const { issues } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(issues.map((one) => one.kind)).toEqual(["focus-order"]);
    expect(issues[0]!.detail).toContain("Tab goes up the page");
  });

  it("reads a footer after a list scrolled to its end as after the list, and finds a real jump back up", async () => {
    const list = `<div style="flex:1;overflow:auto">${Array.from({ length: 12 }, (_, index) => `<button style="display:block;height:40px">Row ${index + 1}</button>`).join("")}</div>`;
    await page.setContent(html(`<div style="display:flex;flex-direction:column;height:300px">${list}<button>Save</button></div>`));
    const { issues, stops } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(stops.at(-1)).toBe('button "Save"');
    expect(issues).toEqual([]);
    // A control drawn above the list that Tab reaches after it still goes up the page.
    await page.setContent(html(`<div style="display:flex;flex-direction:column-reverse;height:300px">${list}<button>Top</button></div>`));
    const back = await checkFocus(page, "#root", { settleMs: 0 });
    expect(back.issues.map((one) => one.kind)).toEqual(["focus-order"]);
    expect(back.issues[0]!.where).toBe('button "Top"');
  });

  it("counts a ring the field around a control draws, when strict", async () => {
    await page.setContent(html(`<div class="field"><input aria-label="Count" value="3"></div>`, `input:focus-visible{outline:none}.field:focus-within{box-shadow:0 0 0 3px blue}`));
    expect((await checkFocus(page, "#root", { settleMs: 0, strictRing: true })).issues).toEqual([]);
    await page.setContent(html(`<div class="field"><input aria-label="Count" value="3"></div>`, `input:focus-visible{outline:none}`));
    expect((await checkFocus(page, "#root", { settleMs: 0, strictRing: true })).issues.map((one) => one.kind)).toEqual(["focus-ring"]);
  });

  it("waits for a ring that fades in before calling it missing, when strict", async () => {
    await page.setContent(html(`<button>Fades in</button>`, `button{outline:0 solid transparent;transition:outline-width 140ms}button:focus-visible{outline:2px solid blue}`));
    expect((await checkFocus(page, "#root", { settleMs: 0, strictRing: true })).issues).toEqual([]);
  });

  it("finds a positive tabindex, and the control Tab then never reaches", async () => {
    // A tabindex above 0 takes B out of reading order: Tab goes A, then round to the page's tabindex 1 outside the
    // panel (where the check stops), and B would only come after that.
    await page.setContent(`${html(`<button>A</button><button tabindex="3">B</button>`)}<button tabindex="1">Outside</button>`);
    const { issues, stops, complete } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(complete).toBe(true);
    expect(stops).toEqual(['button "A"']);
    expect(issues).toEqual([
      { kind: "unreachable", where: 'button "B"', detail: "cannot be reached with the Tab key (or the Tab sequence stopped before it)" },
      { kind: "positive-tabindex", where: 'button "B"', detail: "has a tabindex above 0" },
    ]);
  });

  it("counts an open dialog drawn outside the panel, starting there", async () => {
    await page.setContent(`${html(`<button>Behind</button>`)}<div role="dialog" data-state="open"><div data-slot="dialog-content"><button>Cancel</button><button>Save</button></div></div>`);
    const { stops } = await checkFocus(page, "#root", { settleMs: 0 });
    expect(stops.slice(0, 2)).toEqual(['button "Cancel"', 'button "Save"']);
  });

  it("walks a dialog from its top, not from the field it focused, and the dialog on top of another one", async () => {
    const dialog = (name: string) => `<div role="dialog" data-state="open" tabindex="-1"><button aria-label="Close ${name}">×</button><input aria-label="${name} name"><button>Save ${name}</button></div>`;
    // As with a modal dialog, the page behind it is inert.
    await page.setContent(`${html(`<button>Behind</button>`).replace('<div id="root">', '<div id="root" inert>')}${dialog("Outer")}${dialog("Inner")}`);
    await page.focus("input[aria-label='Inner name']");
    // What Tab does after the last control of the page is the browser's own; the walk's start is what this is about.
    const { stops } = await checkFocus(page, "#root", { settleMs: 0, outside: "[role=dialog]" });
    expect(stops.slice(0, 3)).toEqual(['button[Close Inner] "×"', "input[Inner name]", 'button "Save Inner"']);
  });

  it("finds a ring taken away by CSS only when strict", async () => {
    await page.setContent(html(`<button>No ring</button>`, `button:focus-visible{outline:none}`));
    expect((await checkFocus(page, "#root", { settleMs: 0 })).issues).toEqual([]);
    expect((await checkFocus(page, "#root", { settleMs: 0, strictRing: true })).issues).toEqual([{ kind: "focus-ring", where: 'button "No ring"', detail: "shows no focus ring" }]);
  });

  it("stops after maxStops and then does not guess at unreached controls", async () => {
    await page.setContent(html(`<button>1</button><button>2</button><button>3</button><button>4</button>`));
    const result = await checkFocus(page, "#root", { maxStops: 2, settleMs: 0 });
    expect(result).toEqual({ stops: ['button "1"', 'button "2"'], issues: [], complete: false });
  });
});
