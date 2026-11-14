// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { isTabStop, tabStops } from "./aria-patterns"
import { ariaProblems, danglingReferences, extraTabStops, focusLostAfter } from "./testing"

afterEach(() => {
  document.body.innerHTML = ""
})

function page(html: string): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.append(root)
  return root
}

describe("danglingReferences", () => {
  it("finds nothing when every id is there", () => {
    const root = page(`
      <label for="name" id="name-label">Name</label>
      <input id="name" aria-labelledby="name-label" aria-describedby="name-hint name-error">
      <p id="name-hint">Hint</p><p id="name-error">Error</p>
      <button aria-controls="panel" aria-expanded="true">Open</button><div id="panel"></div>`)
    expect(danglingReferences(root)).toEqual([])
  })

  it("names each id nothing has, with the attribute and the element", () => {
    const root = page(`
      <input data-testid="name" aria-describedby="hint gone">
      <p id="hint"></p>
      <button aria-label="Open" aria-controls="menu-1">Open</button>
      <span aria-labelledby="nobody">x</span>
      <label for="missing">Name</label>`)
    expect(danglingReferences(root)).toEqual([
      'input "name": aria-describedby points at "gone", which isn\'t on the page',
      'button "Open": aria-controls points at "menu-1", which isn\'t on the page',
      'span "x": aria-labelledby points at "nobody", which isn\'t on the page',
      'label "Name": for points at "missing", which isn\'t on the page',
    ])
  })

  it("finds an id outside the root, such as a popup moved to the body", () => {
    const root = page(`<button aria-controls="popup">Open</button>`)
    document.body.insertAdjacentHTML("beforeend", `<div id="popup"></div>`)
    expect(danglingReferences(root)).toEqual([])
  })

  it("checks the root itself too", () => {
    const root = page("")
    root.setAttribute("aria-describedby", "nope")
    expect(danglingReferences(root)).toHaveLength(1)
  })
})

describe("tab stops", () => {
  it("knows what Tab stops on without layout", () => {
    const root = page(`
      <button data-testid="button">B</button>
      <a data-testid="link" href="#">L</a>
      <a data-testid="anchor">no href</a>
      <div data-testid="tabbable" tabindex="0"></div>
      <div data-testid="roving" tabindex="-1"></div>
      <button data-testid="off" disabled>Off</button>
      <fieldset disabled><input data-testid="in-off-set"></fieldset>
      <div hidden><button data-testid="hidden">H</button></div>
      <div style="display: none"><button data-testid="none">N</button></div>
      <div inert><button data-testid="inert">I</button></div>
      <input data-testid="secret" type="hidden">
      <div data-testid="editable" contenteditable="true"></div>`)
    const stop = (id: string) => isTabStop(root.querySelector(`[data-testid=${id}]`)!)
    expect(["button", "link", "tabbable", "editable"].filter(stop)).toEqual(["button", "link", "tabbable", "editable"])
    expect(["anchor", "roving", "off", "in-off-set", "hidden", "none", "inert", "secret"].filter(stop)).toEqual([])
  })

  it("counts radio inputs with one name once, as Tab does", () => {
    const root = page(`<input type="radio" name="a"><input type="radio" name="a"><input type="radio" name="b">`)
    expect(tabStops(root)).toHaveLength(2)
  })
})

describe("extraTabStops", () => {
  it("passes a widget with one stop that moves with the arrow keys", () => {
    const root = page(`
      <div role="radiogroup" aria-label="View">
        <button role="radio" tabindex="0">List</button><button role="radio" tabindex="-1">Grid</button>
      </div>`)
    expect(extraTabStops(root)).toEqual([])
  })

  it("names a widget that Tab stops on more than once, and its stops", () => {
    const root = page(`
      <div role="tablist" aria-label="Views">
        <button role="tab">One</button><button role="tab">Two</button><button role="tab" tabindex="-1">Three</button>
      </div>`)
    expect(extraTabStops(root)).toEqual(['div (tablist) "Views" has 2 Tab stops (button (tab) "One", button (tab) "Two"); it should have one, and the arrow keys move inside it'])
  })

  it("doesn't count the widget itself, which only passes the focus on", () => {
    const root = page(`
      <div role="radiogroup" tabindex="0"><button role="radio" tabindex="0">A</button><button role="radio" tabindex="-1">B</button></div>
      <div role="listbox" tabindex="0" aria-activedescendant="o1"><div role="option" id="o1">One</div></div>`)
    expect(extraTabStops(root)).toEqual([])
  })

  it("leaves a plain group of buttons alone", () => {
    const root = page(`<div role="group"><button>A</button><button>B</button></div>`)
    expect(extraTabStops(root)).toEqual([])
  })
})

describe("ariaProblems", () => {
  it("lists dangling ids and extra stops together", () => {
    const root = page(`<div role="menu"><button aria-describedby="x">A</button><button>B</button></div>`)
    expect(ariaProblems(root)).toHaveLength(2)
  })
})

describe("focusLostAfter", () => {
  it("passes when the focus moves somewhere", async () => {
    const root = page(`<button data-testid="remove">Remove</button><button data-testid="next">Next</button>`)
    const remove = root.querySelector<HTMLButtonElement>("[data-testid=remove]")!
    const next = root.querySelector<HTMLButtonElement>("[data-testid=next]")!
    remove.focus()
    expect(await focusLostAfter(() => { next.focus(); remove.remove() })).toEqual([])
  })

  it("names where the focus was when it falls to the body", async () => {
    const root = page(`<button data-testid="remove">Remove</button>`)
    const remove = root.querySelector<HTMLButtonElement>("[data-testid=remove]")!
    remove.focus()
    expect(await focusLostAfter(() => remove.remove())).toEqual(['The focus fell to the page body after the action (it was on button "remove")'])
  })

  it("waits for an action that is async", async () => {
    const root = page(`<button data-testid="remove">Remove</button>`)
    const remove = root.querySelector<HTMLButtonElement>("[data-testid=remove]")!
    remove.focus()
    expect(await focusLostAfter(() => new Promise<void>((resolve) => setTimeout(() => { remove.remove(); resolve() }, 5)))).toHaveLength(1)
  })

  it("counts nothing when the focus was on the body already", async () => {
    page(`<button>Somewhere</button>`)
    expect(await focusLostAfter(() => {})).toEqual([])
  })
})
