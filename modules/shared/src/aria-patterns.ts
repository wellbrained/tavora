// ARIA pattern checks for component tests in jsdom (or a browser). Each returns what is wrong, one sentence per finding
// naming the element, so `expect(ariaProblems(root)).toEqual([])` fails with a readable list. Exported from
// "@tavora/official-ui/testing". They read only the DOM: no layout, no vitest. For the layout and Tab checks of a whole
// panel in a real browser, use those of `@tavora/sdk/testing`.

/** Attributes that point at other elements by id. */
const REFERENCES = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-errormessage", "aria-activedescendant", "aria-owns", "aria-details", "aria-flowto"] as const

/** Widgets the keyboard enters with one Tab stop and moves through with the arrow keys. */
export const COMPOSITE_ROLES: readonly string[] = ["grid", "listbox", "menu", "menubar", "radiogroup", "tablist", "toolbar", "tree", "treegrid"]

/** What a finding calls an element: its test id, its label, its text, or else its tag and role. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role")
  const testid = element.getAttribute("data-testid")
  const name = element.getAttribute("aria-label") ?? element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40)
  const what = role ? `${tag} (${role})` : tag
  if (testid) return `${what} "${testid}"`
  return name ? `${what} "${name}"` : what
}

/** The root and every element under it. */
function everyElement(root: ParentNode): Element[] {
  const below = [...root.querySelectorAll("*")]
  return root instanceof Element ? [root, ...below] : below
}

function lookUp(element: Element, id: string): Element | null {
  const home = element.getRootNode() as Document | ShadowRoot
  return typeof home.getElementById === "function" ? home.getElementById(id) : element.ownerDocument.getElementById(id)
}

/**
 * Every `aria-labelledby`, `aria-describedby`, `aria-controls` (and the other id references: `aria-errormessage`,
 * `aria-activedescendant`, `aria-owns`, `aria-details`, `aria-flowto`) and every `<label for>` in `root` that names an
 * id nothing on the page has. Ids are looked up in the whole document, so a popup moved to the body still counts.
 */
export function danglingReferences(root: ParentNode = document): string[] {
  const problems: string[] = []
  for (const element of everyElement(root)) {
    const pointers: [string, string][] = REFERENCES.map((name) => [name, element.getAttribute(name) ?? ""])
    if (element.tagName === "LABEL") pointers.push(["for", element.getAttribute("for") ?? ""])
    for (const [name, value] of pointers) {
      for (const id of value.split(/\s+/).filter(Boolean)) {
        if (!lookUp(element, id)) problems.push(`${describeElement(element)}: ${name} points at "${id}", which isn't on the page`)
      }
    }
  }
  return problems
}

function hidden(element: Element): boolean {
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at.hasAttribute("hidden") || at.hasAttribute("inert")) return true
    const style = at.ownerDocument.defaultView?.getComputedStyle(at)
    if (style && (style.display === "none" || style.visibility === "hidden")) return true
  }
  return false
}

/**
 * Whether Tab stops on this element: it can take the focus, has no negative tabindex, is not disabled, and is not
 * hidden or inert. Works without layout, so it also runs in jsdom.
 */
export function isTabStop(element: Element): boolean {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false
  const tabindex = element.getAttribute("tabindex")
  if (tabindex !== null && Number(tabindex) < 0) return false
  const tag = element.tagName.toLowerCase()
  const editable = element.getAttribute("contenteditable")
  const focusable =
    tabindex !== null ||
    (["a", "area"].includes(tag) && element.hasAttribute("href")) ||
    ["button", "select", "textarea", "iframe", "summary"].includes(tag) ||
    (tag === "input" && element.getAttribute("type") !== "hidden") ||
    (editable !== null && editable !== "false")
  if (!focusable) return false
  if ((element as HTMLButtonElement).disabled || element.closest("fieldset[disabled]")) return false
  return !hidden(element)
}

/** The Tab stops in `root` (the root too), in document order. Radio inputs that share a name count once, as Tab does. */
export function tabStops(root: ParentNode = document): Element[] {
  const stops: Element[] = []
  const radios = new Set<string>()
  for (const element of everyElement(root)) {
    if (!isTabStop(element)) continue
    const radio = element instanceof HTMLInputElement && element.type === "radio" && element.name ? element.name : null
    if (radio !== null) {
      if (radios.has(radio)) continue
      radios.add(radio)
    }
    stops.push(element)
  }
  return stops
}

/**
 * Every composite widget in `root` (a `radiogroup`, `tablist`, `listbox`, `menu`, `grid`, `tree`, `toolbar`…; `roles`
 * replaces the list) that Tab stops on more than once inside. Such a widget has one stop, and the arrow keys move inside
 * it. The widget's own element isn't counted: Reka's groups keep it reachable only to pass the focus on to the current
 * item, and a listbox with `aria-activedescendant` is the stop itself.
 */
export function extraTabStops(root: ParentNode = document, roles: readonly string[] = COMPOSITE_ROLES): string[] {
  const problems: string[] = []
  const selector = roles.map((role) => `[role="${role}"]`).join(",")
  if (!selector) return problems
  const widgets = everyElement(root).filter((element) => element.matches(selector))
  for (const widget of widgets) {
    const stops = tabStops(widget).filter((stop) => stop !== widget)
    if (stops.length > 1) {
      problems.push(`${describeElement(widget)} has ${stops.length} Tab stops (${stops.map(describeElement).join(", ")}); it should have one, and the arrow keys move inside it`)
    }
  }
  return problems
}

/** `danglingReferences` and `extraTabStops` together: what is wrong in `root` as it is now. */
export function ariaProblems(root: ParentNode = document): string[] {
  return [...danglingReferences(root), ...extraTabStops(root)]
}

export interface FocusAfterOptions {
  /** Waits until the action's effects are on the page. Default: a task, then an animation frame when there is one. */
  settle?: () => Promise<unknown>
}

const settleDefault = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (typeof requestAnimationFrame === "function") await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

/**
 * Runs `action` (a click, a key, closing a dialog, removing a row) and reports when the focus ends up on the page's
 * body afterwards: the keyboard user is lost and the next Tab starts from the top. Focus that was on the body before
 * the action is not counted.
 */
export async function focusLostAfter(action: () => unknown, options: FocusAfterOptions = {}): Promise<string[]> {
  const before = document.activeElement
  const from = before && before !== document.body ? describeElement(before) : null
  await action()
  await (options.settle ?? settleDefault)()
  const now = document.activeElement
  if (from === null || (now && now !== document.body && now !== document.documentElement)) return []
  return [`The focus fell to the page body after the action (it was on ${from})`]
}
