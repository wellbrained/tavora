import { createApp, h, reactive } from "vue";
import Tooltip from "./components/tooltip/Tooltip";

const installed = new WeakMap<Document, () => void>();

/** One readable hover layer for existing official-module title hints. */
export function installTitleTooltips(doc: Document = document): () => void {
  const existing = installed.get(doc);
  if (existing) return existing;
  const container = doc.createElement("div");
  container.dataset.tooltipLayer = "titles";
  doc.body.append(container);
  const state = reactive({ open: false, title: "", at: { x: 0, y: 0 } });
  const id = "tavora-title-tooltip";
  const suppressed = new WeakSet<Element>();
  let current: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let keyboard = false;

  function hide() {
    clearTimeout(timer);
    state.open = false;
    if (current) {
      const ids = (current.getAttribute("aria-describedby") ?? "").split(" ").filter(value => value && value !== id);
      if (ids.length) current.setAttribute("aria-describedby", ids.join(" "));
      else current.removeAttribute("aria-describedby");
    }
    current = null;
  }
  const app = createApp({ render: () => h(Tooltip, { ...state, title: "", description: state.title, id, onDismiss: hide }) });
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
    return event.target instanceof Element ? event.target.closest("[title],[data-tavora-tooltip]") : null;
  }
  function show(element: Element, at: { x: number; y: number }) {
    if (element === current) { state.at = at; return; }
    const title = element.getAttribute("title") || element.getAttribute("data-tavora-tooltip");
    if (!title?.trim()) return;
    hide();
    current = element;
    if (element.getAttribute("title")) remember(element, title);
    state.title = title;
    state.at = at;
    timer = setTimeout(() => {
      if (current !== element || !element.isConnected) return;
      state.open = true;
      const old = element.getAttribute("aria-describedby");
      element.setAttribute("aria-describedby", old ? old + " " + id : id);
    }, 180);
  }
  const over = (event: PointerEvent) => {
    const element = target(event);
    if (element) show(element, { x: event.clientX, y: event.clientY });
  };
  const move = (event: PointerEvent) => { if (current) state.at = { x: event.clientX, y: event.clientY }; };
  const out = (event: PointerEvent) => {
    if (current && !(event.relatedTarget instanceof Node && current.contains(event.relatedTarget))) hide();
  };
  const focus = (event: FocusEvent) => {
    if (!keyboard) return;
    const element = target(event);
    if (element) { const bounds = element.getBoundingClientRect(); show(element, { x: bounds.right, y: bounds.top + bounds.height / 2 }); }
  };
  const key = (event: KeyboardEvent) => { if (event.key === "Tab") keyboard = true; if (event.key === "Escape") hide(); };
  const down = () => { keyboard = false; hide(); };
  doc.addEventListener("pointerover", over, true);
  doc.addEventListener("pointermove", move, true);
  doc.addEventListener("pointerout", out, true);
  doc.addEventListener("focusin", focus, true);
  doc.addEventListener("focusout", hide, true);
  doc.addEventListener("pointerdown", down, true);
  doc.addEventListener("keydown", key, true);
  const observer = new MutationObserver(records => {
    if (current && !current.isConnected) hide();
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
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
  const dispose = () => {
    hide();
    observer.disconnect();
    for (const element of Array.from(doc.querySelectorAll("[data-tavora-tooltip]"))) {
      if (!element.getAttribute("title")) element.setAttribute("title", element.getAttribute("data-tavora-tooltip")!);
      element.removeAttribute("data-tavora-tooltip");
      if (element.hasAttribute("data-tooltip-label")) { element.removeAttribute("aria-label"); element.removeAttribute("data-tooltip-label"); }
    }
    app.unmount();
    container.remove();
    doc.removeEventListener("pointerover", over, true);
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerout", out, true);
    doc.removeEventListener("focusin", focus, true);
    doc.removeEventListener("focusout", hide, true);
    doc.removeEventListener("pointerdown", down, true);
    doc.removeEventListener("keydown", key, true);
    installed.delete(doc);
  };
  installed.set(doc, dispose);
  return dispose;
}
