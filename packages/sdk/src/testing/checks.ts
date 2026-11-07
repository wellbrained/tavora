// Checks on what a panel draws, for tests in a real browser: things sticking out of the panel, text that is cut off or
// smaller than 12 px, input values that don't fit, and how the Tab key goes through the controls.
//
// They need a browser that lays the page out (jsdom has no layout, so they find nothing there). Two ways to run them:
//   - in the page, next to the panel (vitest browser mode, say): `inspectLayout(root)`, `inspectFocus(root, { pressTab })`;
//   - from Node, driving the page (Playwright, Puppeteer): `checkLayout(page, root)`, `checkFocus(page, root)`.
// The SDK depends on neither: a `TestPage` is anything with `evaluate(expression)` and `keyboard.press(key)`.
//
// The functions that run in the page are sent to it as text, so each is self-contained: they use nothing from outside
// their own body (that is why `describe` is written out in each).

/** @since 0.3.14 */
export type LayoutIssueKind =
  /** Sticks out of the panel's box, and nothing around it clips or scrolls it. */
  | "overflow"
  /** The whole page is wider than the window, so it scrolls sideways. */
  | "page-overflow"
  /** Text or an input value is cut off, or shortened with an ellipsis and no title to read it in full. */
  | "clipped"
  /** Text under the smallest size (12 px). */
  | "small-text";

/** @since 0.3.14 */
export type FocusIssueKind =
  /** A Tab stop shows no focus ring. */
  | "focus-ring"
  /** Tab jumps up the page, or left within a row. */
  | "focus-order"
  /** A visible control Tab never reaches. */
  | "unreachable"
  /** A tabindex above 0, which takes the control out of reading order. */
  | "positive-tabindex";

/** One finding: what kind, which element (its test id, label or text), and what is wrong. @since 0.3.14 */
export interface CheckIssue<K extends string = LayoutIssueKind | FocusIssueKind> {
  kind: K;
  /** The element, such as `button[save] "Save"`: tag, then test id, aria-label or title, then the first 40 characters of text. */
  where: string;
  detail: string;
}

/** @since 0.3.14 */
export type LayoutIssue = CheckIssue<LayoutIssueKind>;
/** @since 0.3.14 */
export type FocusIssue = CheckIssue<FocusIssueKind>;

/** @since 0.3.14 */
export interface LayoutCheckOptions {
  /** Text below this many CSS pixels is a finding. Default 12, the kit's smallest size. */
  minFontSize?: number;
  /** Parts drawn outside the panel's box on purpose. Default: the kit's dialogs, `[data-slot=dialog-content]`. */
  outside?: string;
  /** Parts not checked, with what is inside them. Default `[aria-hidden=true], .sr-only, [data-slot=skeleton]`. */
  skip?: string;
}

/** @since 0.3.14 */
export interface FocusCheckOptions {
  /** Most Tab presses before the check stops. Default 90. */
  maxStops?: number;
  /** How long to let anything fading in or out settle before looking for controls Tab missed, in ms. Default 400. */
  settleMs?: number;
  /** Controls outside the panel's box that still count as stops (a dialog drawn at the end of the page). Default `[data-slot=dialog-content]`. */
  outside?: string;
  /** Where Tab starts when it is on the page: the top of an open dialog. Default `[role=dialog][data-state=open]`; else the panel. */
  start?: string;
  /** Controls that need not be reachable. Default: the kit slider's Reset, `[data-slot=slider-reset]`, which shows only now and then. */
  skip?: string;
  /**
   * Count only a drawn ring (an outline or a box-shadow) as a focus ring. Default false: a control that matches
   * `:focus-visible` counts too, which every control Tab reaches does, so a ring taken away by CSS goes unseen. Strict, a
   * ring that is still fading in when it is measured counts as missing.
   */
  strictRing?: boolean;
}

/** @since 0.3.14 */
export interface FocusResult {
  /** The Tab stops in order, described like `CheckIssue.where`. */
  stops: string[];
  issues: FocusIssue[];
  /** Whether Tab went all the way round (or left the panel). Only then are unreached controls looked for. */
  complete: boolean;
}

/**
 * A page a test drives from Node. A Playwright or Puppeteer `Page` is one. @since 0.3.14
 */
export interface TestPage {
  /** Runs a JavaScript expression in the page and resolves with its (JSON) value. */
  evaluate(expression: string): Promise<unknown>;
  keyboard: { press(key: string): Promise<unknown> };
}

/**
 * Looks at everything visible in `root` (a selector or an element, default the whole page) and lists what is wrong: an
 * element that sticks out of the panel's box without anything around it clipping or scrolling it, a page that scrolls
 * sideways, text cut off without an ellipsis, an ellipsis with no title to read the whole text, an input value that is
 * cut off by its field, and text under 12 px. Runs in the page; it needs a browser that lays the page out (not jsdom).
 * Self-contained, so `page.evaluate(inspectLayout, "#panel")` works too; `checkLayout` does that for you.
 *
 * @since 0.3.14
 */
export function inspectLayout(root: string | Element = "body", options: LayoutCheckOptions = {}): LayoutIssue[] {
  const describe = (el: Element): string => {
    const own = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return el.tagName.toLowerCase() + (own ? `[${own}]` : "") + (text ? ` "${text}"` : "");
  };
  const minFontSize = options.minFontSize ?? 12;
  const outside = options.outside ?? "[data-slot=dialog-content]";
  const skip = options.skip ?? "[aria-hidden=true], .sr-only, [data-slot=skeleton]";
  const box = typeof root === "string" ? document.querySelector(root) : root;
  const name = typeof root === "string" ? root : describe(root);
  if (!box) return [{ kind: "overflow", where: name, detail: "the panel is not on the page" }];
  const edge = box.getBoundingClientRect();
  const issues: LayoutIssue[] = [];
  const seen = new Set<string>();
  const add = (kind: LayoutIssueKind, el: Element, detail: string) => {
    const where = describe(el);
    const key = `${kind}|${where}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, where, detail });
  };
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // An element may extend past the panel's box when something around it (the box itself too) clips or scrolls it on that axis.
  const clippedAround = (el: Element) => {
    for (let parent = el.parentElement; parent && parent !== box.parentElement; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX !== "visible") return true;
    }
    return false;
  };
  const page = document.documentElement;
  if (page.scrollWidth > window.innerWidth + 1) add("page-overflow", page, `the page is ${page.scrollWidth}px wide in a ${window.innerWidth}px window`);

  for (const el of Array.from(box.querySelectorAll("*"))) {
    if (!visible(el) || el.closest(skip)) continue;
    const rect = el.getBoundingClientRect();
    if ((rect.right > edge.right + 1 || rect.left < edge.left - 1) && !clippedAround(el) && !el.closest(outside)) {
      add("overflow", el, `extends ${Math.round(Math.max(rect.right - edge.right, edge.left - rect.left))}px past the panel's edge`);
    }
    const style = getComputedStyle(el);
    // The value a text field shows is cut off by the field's own edge.
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && (el as HTMLInputElement).value && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      add("clipped", el, `the value is ${el.scrollWidth}px wide in a ${el.clientWidth}px field, so it shows cut off ("${(el as HTMLInputElement).value.slice(0, 40)}")`);
    }
    const hasText = Array.from(el.childNodes).some((node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0);
    if (!hasText) continue;
    const size = parseFloat(style.fontSize);
    if (size < minFontSize - 0.01) add("small-text", el, `${size}px text`);
    // Cut off sideways without an ellipsis (a truncate that shows its ellipsis is fine).
    if ((style.overflowX === "hidden" || style.overflowX === "clip") && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== "ellipsis") {
      add("clipped", el, `text is ${el.scrollWidth}px wide in a ${el.clientWidth}px box`);
    }
    if ((style.overflowY === "hidden" || style.overflowY === "clip") && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2 && style.display !== "inline") {
      add("clipped", el, `text is ${el.scrollHeight}px tall in a ${el.clientHeight}px box`);
    }
    // An ellipsis with nothing to read the whole text from.
    if (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && !el.getAttribute("title") && !el.closest("[title]") && !el.getAttribute("aria-label")) {
      add("clipped", el, `shortened with an ellipsis (${el.scrollWidth}px in ${el.clientWidth}px) and no title to read it in full`);
    }
  }
  return issues;
}

/** One Tab stop, as the page reports it. */
interface Stop {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ring: boolean;
  group: string | null;
  /** A scrollable area the browser itself makes focusable (so keys can scroll it), not a control. */
  scroller: boolean;
}

/** In the page: blur, and put the focus at the top of what the user is in, so the next Tab goes to the first control. */
function focusBegin(arg: { root: string; start: string }): void {
  (document.activeElement as HTMLElement | null)?.blur();
  const start = document.querySelector<HTMLElement>(arg.start) ?? document.querySelector<HTMLElement>(arg.root);
  if (!start) return;
  const had = start.getAttribute("tabindex");
  start.setAttribute("tabindex", "-1");
  start.focus({ preventScroll: true });
  if (had === null) start.removeAttribute("tabindex");
  else start.setAttribute("tabindex", had);
  for (const el of Array.from(document.querySelectorAll("*"))) if (el.scrollTop) el.scrollTop = 0;
}

/** In the page: the focused control, or null when the focus left the panel. */
function focusStop(arg: { root: string; outside: string; strictRing: boolean }): Stop | null {
  const describe = (el: Element): string => {
    const own = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return el.tagName.toLowerCase() + (own ? `[${own}]` : "") + (text ? ` "${text}"` : "");
  };
  const el = document.activeElement as HTMLElement | null;
  const root = document.querySelector(arg.root);
  if (!el || el === document.body || !root || !(root.contains(el) || el.closest(arg.outside))) return null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  // Where it sits in the page's content, whatever the scroll areas around it have scrolled by.
  let scrolled = 0;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) scrolled += parent.scrollTop;
  const scroller = !el.matches("button, a[href], input, select, textarea, [role]") && ["auto", "scroll"].includes(style.overflowY);
  // The ring is an outline or a box-shadow; unless strict, a control that matches :focus-visible counts too (so that
  // cannot see a ring removed by CSS: it checks that one is meant to show).
  const drawn = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || (style.boxShadow !== "none" && style.boxShadow !== "");
  const ring = drawn || (!arg.strictRing && el.matches(":focus-visible"));
  const group = el.closest("[role=radiogroup], [role=tablist], [role=menu], [role=listbox]");
  return { label: describe(el), x: rect.x, y: rect.y + scrolled, w: rect.width, h: rect.height, ring, group: group ? describe(group) : null, scroller };
}

/** In the page: visible controls that are no Tab stop (a group counts as reached when one member is), and positive tabindexes. */
function focusReach(arg: { root: string; labels: string[]; skip: string }): { missing: string[]; positive: string[] } {
  const describe = (el: Element): string => {
    const own = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return el.tagName.toLowerCase() + (own ? `[${own}]` : "") + (text ? ` "${text}"` : "");
  };
  const root = document.querySelector(arg.root);
  const missing: string[] = [];
  const positive: string[] = [];
  if (!root) return { missing, positive };
  const stops = new Set(arg.labels);
  const controls = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=checkbox], [tabindex]";
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(controls))) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (el.closest("[inert], [aria-hidden=true]") || (arg.skip && el.matches(arg.skip))) continue;
    if (el.tabIndex > 0) positive.push(describe(el));
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
    const group = el.closest("[role=radiogroup], [role=tablist], [role=menu], [role=listbox], [role=menubar]");
    if (group) {
      // One Tab stop for the whole group: some member of it must be a stop.
      const members = Array.from(group.querySelectorAll("[role=radio], input[type=radio], [role=tab], [role=menuitem], [role=option], button")).map(describe);
      if (!members.some((member) => stops.has(member))) missing.push(`${describe(group)} (group)`);
    } else if (!stops.has(describe(el))) missing.push(describe(el));
  }
  return { missing: [...new Set(missing)], positive };
}

/** What the stops say: rings, reading order, and (when Tab went all the way round) the controls it never reached. */
function focusIssues(stops: Stop[], reach: { missing: string[]; positive: string[] }): FocusIssue[] {
  const issues: FocusIssue[] = [];
  for (const stop of stops) if (!stop.ring && !stop.scroller) issues.push({ kind: "focus-ring", where: stop.label, detail: "shows no focus ring" });
  // Reading order: top to bottom, left to right within a row. A stop in the next column (to the right of the one before,
  // such as a settings page's content after its menu) may start higher up; a radio group or tab list may go either way.
  for (let index = 1; index < stops.length; index++) {
    const before = stops[index - 1]!;
    const stop = stops[index]!;
    if (before.scroller || stop.scroller) continue;
    const overlap = Math.min(before.y + before.h, stop.y + stop.h) - Math.max(before.y, stop.y);
    const sameRow = overlap > Math.min(before.h, stop.h) * 0.5;
    const nextColumn = stop.x >= before.x + before.w - 4;
    if (stop.y < before.y - 4 && !sameRow && !nextColumn) {
      issues.push({ kind: "focus-order", where: stop.label, detail: `Tab goes up the page: from "${before.label}" (y ${Math.round(before.y)}) to "${stop.label}" (y ${Math.round(stop.y)})` });
    }
    if (sameRow && stop.x < before.x - 4 && stop.y >= before.y - 4 && !(before.group && before.group === stop.group)) {
      issues.push({ kind: "focus-order", where: stop.label, detail: `Tab goes left within a row: "${before.label}" to "${stop.label}"` });
    }
  }
  for (const one of reach.missing) issues.push({ kind: "unreachable", where: one, detail: "cannot be reached with the Tab key (or the Tab sequence stopped before it)" });
  for (const one of reach.positive) issues.push({ kind: "positive-tabindex", where: one, detail: "has a tabindex above 0" });
  return issues;
}

type Run = <A, R>(fn: (arg: A) => R, arg: A) => Promise<R>;

async function runFocus(run: Run, pressTab: () => Promise<unknown>, root: string, options: FocusCheckOptions): Promise<FocusResult> {
  const outside = options.outside ?? "[data-slot=dialog-content]";
  const max = options.maxStops ?? 90;
  await run(focusBegin, { root, start: options.start ?? "[role=dialog][data-state=open]" });
  const stops: Stop[] = [];
  let complete = false;
  for (let step = 0; step < max; step++) {
    await pressTab();
    const stop = await run(focusStop, { root, outside, strictRing: options.strictRing ?? false });
    const first = stops[0];
    if (!stop || (first && first.label === stop.label && first.x === stop.x && first.y === stop.y)) {
      complete = true;
      break;
    }
    stops.push(stop);
  }
  let reach = { missing: [] as string[], positive: [] as string[] };
  if (complete) {
    await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 400));
    reach = await run(focusReach, { root, labels: stops.map((one) => one.label), skip: options.skip ?? "[data-slot=slider-reset]" });
  }
  return { stops: stops.map((one) => one.label), issues: focusIssues(stops, reach), complete };
}

/**
 * Presses Tab through the panel `root` (a selector) and checks: every visible control can be reached (a radio group or
 * tab list counts as one stop), the order follows reading order (top to bottom, left to right within a row), no control
 * has a tabindex above 0, and each stop shows a focus ring. Runs in the page, so it needs a real Tab press from outside
 * it: `pressTab` (in vitest browser mode, `() => userEvent.tab()`). From Node use `checkFocus`.
 *
 * @since 0.3.14
 */
export function inspectFocus(root: string, options: FocusCheckOptions & { pressTab(): unknown }): Promise<FocusResult> {
  const run: Run = async (fn, arg) => fn(arg);
  return runFocus(run, async () => options.pressTab(), root, options);
}

/** Runs one of the self-contained page functions above in `page`. */
const inPage = (page: TestPage): Run => async (fn, arg) => (await page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`)) as never;

/**
 * `inspectLayout` from Node: runs it in `page` (a Playwright or Puppeteer page) on the panel `root`.
 *
 * ```ts
 * expect(await checkLayout(page, "#panel")).toEqual([]);
 * ```
 *
 * @since 0.3.14
 */
export async function checkLayout(page: TestPage, root: string, options: LayoutCheckOptions = {}): Promise<LayoutIssue[]> {
  return (await page.evaluate(`(${inspectLayout.toString()})(${JSON.stringify(root)}, ${JSON.stringify(options)})`)) as LayoutIssue[];
}

/**
 * `inspectFocus` from Node: presses Tab in `page` (a Playwright or Puppeteer page) through the panel `root`.
 *
 * ```ts
 * const { issues, stops } = await checkFocus(page, "#panel");
 * expect(issues).toEqual([]);
 * ```
 *
 * @since 0.3.14
 */
export function checkFocus(page: TestPage, root: string, options: FocusCheckOptions = {}): Promise<FocusResult> {
  return runFocus(inPage(page), () => page.keyboard.press("Tab"), root, options);
}
