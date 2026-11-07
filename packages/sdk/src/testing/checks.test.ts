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
