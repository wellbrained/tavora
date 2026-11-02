// The Overlay page's view as the main process last sent it (the page in the main window and the layer on the canvas both
// use it), and the keys both share: the arrow keys nudge the selected frames (together), Del and Backspace remove them,
// Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) undo and redo, Esc lets go of the selection.
import { nextTick, onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { LayoutItemView, LayoutMessage, LayoutStills, LayoutView } from "../../../shared/layout-view";
import { boundsOf, moveGroup, nudge } from "../../../shared/layout-math";
import { api } from "../../host";

export const view = shallowRef<LayoutView | null>(null);
api.layout.onState((next) => (view.value = next));
void api.layout.getState().then((initial) => {
  if (initial && !view.value) view.value = initial;
});

export const send = (message: LayoutMessage) => api.layout.send(message);

/** Still pictures of the live pages and of the layer, drawn where they are while a list or menu is open over the canvas. */
export const stills = shallowRef<LayoutStills>({ items: [], layer: null });
let stillChanges = 0;
function decoded(url: string): Promise<unknown> {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined);
}
api.layout.onStills(async (next) => {
  const change = ++stillChanges;
  const urls = [...next.items.map((item) => item.url), ...(next.layer ? [next.layer.url] : [])];
  // Said to be shown only once they are decoded and a frame with them was drawn: the pages step aside after that.
  await Promise.all(urls.map(decoded));
  if (change !== stillChanges) return;
  stills.value = next;
  if (!urls.length) return;
  await nextTick();
  requestAnimationFrame(() => requestAnimationFrame(() => change === stillChanges && api.layout.stillsShown()));
});

/** Where a key press should be left to its field: a list, a text field, a row of choices. */
function belongsToControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("input, textarea, select, [contenteditable], [role=radiogroup], [role=listbox], [role=menu], [role=dialog]") !== null;
}

export function onLayoutKey(event: KeyboardEvent): void {
  const current = view.value;
  if (!current || belongsToControl(event.target)) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    if (key === "z" && !event.shiftKey) send({ type: "undo" });
    else if (key === "y" || (key === "z" && event.shiftKey)) send({ type: "redo" });
    else return;
    event.preventDefault();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (key === "escape") {
    send({ type: "select", id: null });
    return;
  }
  const selected = selectedItems(current);
  if (key === "delete" || key === "backspace") {
    if (!selected.length) return;
    event.preventDefault();
    if (!event.repeat) send({ type: "remove", ids: selected.map((item) => item.id) });
    return;
  }
  const direction = ({ arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down" } as const)[key as "arrowleft"];
  const shown = selected.filter((item) => !item.hiddenOnCanvas);
  if (!direction || !shown.length) return;
  event.preventDefault();
  if (shown.length === 1) {
    send({ type: "commit", id: shown[0]!.id, rect: nudge(shown[0]!.placed, direction, current.canvas, current.cell, event.shiftKey) });
    return;
  }
  // Several move as one: their box is nudged, and each by as much.
  const rects = shown.map((item) => item.placed);
  const box = boundsOf(rects)!;
  const to = nudge(box, direction, current.canvas, current.cell, event.shiftKey);
  const moved = moveGroup(rects, to.x - box.x, to.y - box.y, current.canvas);
  send({ type: "commit", rects: shown.map((item, index) => ({ id: item.id, rect: moved[index]! })) });
}

/** The selected items of a view, in the order they were picked. */
export function selectedItems(current: LayoutView | null): LayoutItemView[] {
  if (!current) return [];
  return current.selected.flatMap((id) => current.items.filter((item) => item.id === id));
}

/** Installs the shared keys on the page while the component is mounted. */
export function useLayoutKeys(): void {
  onMounted(() => addEventListener("keydown", onLayoutKey));
  onBeforeUnmount(() => removeEventListener("keydown", onLayoutKey));
}
