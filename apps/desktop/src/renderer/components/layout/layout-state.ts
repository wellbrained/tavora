// The Overlay layout's view as the main process last sent it (both pages of the window use it), and the keys both pages
// share: the arrow keys nudge the selected item, Ctrl+Z and Ctrl+Y undo and redo, Esc lets go of the selection.
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { LayoutMessage, LayoutView } from "../../../shared/layout-view";
import { nudge } from "../../../shared/layout-math";
import { api } from "../../host";

export const view = shallowRef<LayoutView | null>(null);
api.layout.onState((next) => (view.value = next));
void api.layout.getState().then((initial) => {
  if (initial && !view.value) view.value = initial;
});

export const send = (message: LayoutMessage) => api.layout.send(message);

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
  const direction = ({ arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down" } as const)[key as "arrowleft"];
  const item = current.items.find((candidate) => candidate.id === current.selection);
  if (!direction || !item || item.hiddenOnCanvas) return;
  event.preventDefault();
  send({ type: "commit", id: item.id, rect: nudge(item.placed, direction, current.canvas, current.cell, event.shiftKey) });
}

/** Installs the shared keys on the page while the component is mounted. */
export function useLayoutKeys(): void {
  onMounted(() => addEventListener("keydown", onLayoutKey));
  onBeforeUnmount(() => removeEventListener("keydown", onLayoutKey));
}
