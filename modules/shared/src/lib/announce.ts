// Tells a screen reader something without moving the focus, through one polite status region the kit keeps at the end
// of the page. For a control that can't hold a region of its own (a `Button` has to stay one element, so a menu trigger
// or a tooltip can wrap it). The same words said twice are read twice: the region is emptied first.

let region: HTMLElement | null = null
let pending: ReturnType<typeof setTimeout> | undefined

function theRegion(): HTMLElement {
  if (region?.isConnected) return region
  region = document.createElement("div")
  region.setAttribute("role", "status")
  region.setAttribute("aria-live", "polite")
  region.dataset.slot = "kit-announcer"
  // Visually hidden, still read (the sr-only recipe, inline so it works without the kit's styles).
  region.style.cssText = "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"
  document.body.append(region)
  return region
}

/** Says `text` to a screen reader once, politely (after what it is reading now). Empty text says nothing. */
export function announce(text: string): void {
  if (typeof document === "undefined" || text.trim() === "") return
  const el = theRegion()
  el.textContent = ""
  clearTimeout(pending)
  // A beat later, so a reader notices the change even when the words are the same as last time.
  pending = setTimeout(() => {
    el.textContent = text
  }, 50)
}
