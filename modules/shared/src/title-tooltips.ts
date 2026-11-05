import { createApp, h, reactive } from "vue";
import Tooltip, { tooltipDelay } from "./components/tooltip/Tooltip";
import type { TooltipSide } from "./components/tooltip/geometry";

const installed = new WeakMap<Document, () => void>();

export interface TitleTooltipOptions {
  /** Called when a hint appears or goes away, so a host can draw it above views that would cover it. */
  onOpenChange?: (open: boolean) => void;
  /** Called when the pointer or focus rests on an element with a hint and it will show soon, so a host can get ready for drawing it. */
  onPending?: () => void;
}

/** On a switched-off control that can say why (`disabledReason` in the kit): the reason, shown like a hint. It is not a `title`, so it never names the control. */
export const REASON_ATTRIBUTE = "data-tavora-reason";
/** On an element whose hint should open beside it (`left` or `right`) instead of below, such as a menu row that must not be covered. */
export const SIDE_ATTRIBUTE = "data-tooltip-side";

/** One readable hover layer for title hints, in official modules and in the host: the compact card below the element, as the rail's.
 * An element's `aria-keyshortcuts` shows beside the hint as key caps. */
export function installTitleTooltips(doc: Document = document, options: TitleTooltipOptions = {}): () => void {
  const existing = installed.get(doc);
  if (existing) return existing;
  const container = doc.createElement("div");
  container.dataset.tooltipLayer = "titles";
  doc.body.append(container);
  const state = reactive({ open: false, title: "", side: "bottom" as TooltipSide, shortcut: undefined as string | undefined, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
  const id = "tavora-title-tooltip";
  const suppressed = new WeakSet<Element>();
  let current: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboard = false;

  // The page is watched for added and removed elements only while a hint is on the way or showing, to close it
  // when its element goes: otherwise every change anywhere in the page would be looked at for nothing.
  const gone = new MutationObserver(() => {
    if (current && !current.isConnected) hide();
  });

  function hide() {
    gone.disconnect();
    clearTimeout(timer);
    clearTimeout(readyTimer);
    if (state.open) options.onOpenChange?.(false);
    state.open = false;
    if (current) {
      const ids = (current.getAttribute("aria-describedby") ?? "").split(" ").filter(value => value && value !== id);
      if (ids.length) current.setAttribute("aria-describedby", ids.join(" "));
      else current.removeAttribute("aria-describedby");
    }
    current = null;
  }
  const app = createApp({ render: () => h(Tooltip, { ...state, title: "", description: state.title, id, compact: true, onDismiss: hide }) });
  app.mount(container);

  function remember(element: Element, value: string) {
    element.setAttribute("data-tavora-tooltip", value);
    // Keep an empty attribute so a framework can subsequently remove a dynamic title.
    // Removing it here would make that later update invisible to MutationObserver.
    suppressed.add(element);
    element.setAttribute("title", "");
    if (element.hasAttribute("data-tooltip-label") || (!element.hasAttribute("aria-label") && !element.textContent?.trim())) {
      element.setAttribute("aria-label", value);
      element.setAttribute("data-tooltip-label", "true");
    }
  }
  function target(event: Event) {
    return event.target instanceof Element ? event.target.closest(`[title],[data-tavora-tooltip],[${REASON_ATTRIBUTE}]`) : null;
  }
  function show(element: Element) {
    if (element === current) return;
    // A reason a control gives for being off comes before any hint it has when on.
    const own = element.getAttribute("title") || element.getAttribute("data-tavora-tooltip");
    const title = element.getAttribute(REASON_ATTRIBUTE) || own;
    if (!title?.trim()) return;
    hide();
    current = element;
    gone.observe(doc.body, { childList: true, subtree: true });
    if (element.getAttribute("title")) remember(element, element.getAttribute("title")!);
    state.title = title;
    const side = element.getAttribute(SIDE_ATTRIBUTE);
    state.side = side === "left" || side === "right" || side === "top" ? side : "bottom";
    state.shortcut = element.getAttribute("aria-keyshortcuts") || undefined;
    // Half way to the hint, so a pointer just passing over a row of buttons gets ready for none of them. The host
    // does not repeat the work for hints that follow each other.
    const wait = tooltipDelay(180);
    if (options.onPending) readyTimer = setTimeout(options.onPending, wait / 2);
    timer = setTimeout(() => {
      if (current !== element || !element.isConnected) return;
      const { left, top, right, bottom } = element.getBoundingClientRect();
      state.anchor = { left, top, right, bottom };
      state.open = true;
      options.onOpenChange?.(true);
      const old = element.getAttribute("aria-describedby");
      element.setAttribute("aria-describedby", old ? old + " " + id : id);
    }, wait);
  }
  const over = (event: PointerEvent) => {
    const element = target(event);
    if (element) show(element);
  };
  // Only the pointer leaving the hint's own element closes it: a layout change under a resting pointer fires
  // pointerout elsewhere, and that must not close a hint opened from the keyboard.
  const out = (event: PointerEvent) => {
    if (!current || !(event.target instanceof Node) || !current.contains(event.target)) return;
    if (!(event.relatedTarget instanceof Node && current.contains(event.relatedTarget))) hide();
  };
  const focus = (event: FocusEvent) => {
    if (!keyboard) return;
    const element = target(event);
    if (element) show(element);
  };
  // Keys that move the focus: a hint follows it when it was moved by the keyboard (Tab, or the arrows through a menu).
  const FOCUS_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
  // Focus leaving some other element (a menu moving its focus to the row under the pointer) leaves this hint be.
  const blur = (event: FocusEvent) => {
    if (current && event.target instanceof Node && current.contains(event.target)) hide();
  };
  const key = (event: KeyboardEvent) => { if (FOCUS_KEYS.has(event.key)) keyboard = true; if (event.key === "Escape") hide(); };
  const down = () => { keyboard = false; hide(); };
  doc.addEventListener("pointerover", over, true);
  doc.addEventListener("pointerout", out, true);
  doc.addEventListener("focusin", focus, true);
  doc.addEventListener("focusout", blur, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("keydown", key, true);
  // A title that changes, appears or goes away; nothing else in the page matters here.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type !== "attributes" || !(record.target instanceof Element)) continue;
      const element = record.target;
      if (suppressed.delete(element)) continue;
      const value = element.getAttribute("title");
      if (value?.trim()) {
        remember(element, value);
        if (current === element) state.title = value;
      } else {
        element.removeAttribute("data-tavora-tooltip");
        if (element.hasAttribute("data-tooltip-label")) { element.removeAttribute("aria-label"); element.removeAttribute("data-tooltip-label"); }
        if (current === element) hide();
      }
    }
  });
  observer.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["title"] });
  const dispose = () => {
    hide();
    observer.disconnect();
    gone.disconnect();
    for (const element of Array.from(doc.querySelectorAll("[data-tavora-tooltip]"))) {
      if (!element.getAttribute("title")) element.setAttribute("title", element.getAttribute("data-tavora-tooltip")!);
      element.removeAttribute("data-tavora-tooltip");
      if (element.hasAttribute("data-tooltip-label")) { element.removeAttribute("aria-label"); element.removeAttribute("data-tooltip-label"); }
    }
    app.unmount();
    container.remove();
    doc.removeEventListener("pointerover", over, true);
    doc.removeEventListener("pointerout", out, true);
    doc.removeEventListener("focusin", focus, true);
    doc.removeEventListener("focusout", blur, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key, true);
    installed.delete(doc);
  };
  installed.set(doc, dispose);
  return dispose;
}
