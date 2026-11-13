import { isComposing } from "@tavora/official-ui/lib/keys";
import { nextTick, ref, watch, type Ref } from "vue";

/** How far Page Up and Page Down jump. */
const PAGE = 10;

/**
 * Arrow-key navigation for a list while focus stays in a text field
 * (combobox + listbox with aria-activedescendant). The arrows wrap around at the ends, Page Up and Down jump ten
 * rows, Ctrl+Home and Ctrl+End go to the first and last row (plain Home and End move the caret in the field), and the
 * highlighted row scrolls into view; Enter runs `onEnter`. Keys an input method uses to compose text are left alone.
 */
export function useListNav(options: {
  count: () => number;
  /** The scrolling list element; its row marked aria-selected="true" is scrolled into view. */
  list: Ref<HTMLElement | null>;
  onEnter: () => unknown;
  /**
   * Each row's id, in order. With it, the highlight stays on the same row when rows come in or go around it (results
   * that arrive late), and goes back to the top only when `resetOn` changes (the typed text).
   */
  track?: { keys: () => readonly string[]; resetOn: () => unknown };
}) {
  const active = ref(0);

  if (options.track) {
    const { keys, resetOn } = options.track;
    watch([resetOn, keys], ([reset, next], [wasReset, before]) => {
      if (reset !== wasReset) {
        active.value = 0;
        return;
      }
      const index = next.indexOf(before[active.value] ?? "");
      active.value = index >= 0 ? index : Math.min(active.value, Math.max(0, next.length - 1));
    });
  }

  async function scrollToActive() {
    await nextTick();
    options.list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  async function move(by: number) {
    const count = options.count();
    if (!count) return;
    active.value = (active.value + by + count) % count;
    await scrollToActive();
  }

  /** Jumps without wrapping: Page Up on the first rows lands on the first one. */
  async function jump(to: number) {
    const count = options.count();
    if (!count) return;
    active.value = Math.min(count - 1, Math.max(0, to));
    await scrollToActive();
  }

  /** Put on the field's keydown. */
  function onKey(event: KeyboardEvent) {
    if (isComposing(event)) return;
    // With Shift, Ctrl+Home and Ctrl+End select text in the field; only without it do they move the highlight.
    const ctrl = (event.ctrlKey || event.metaKey) && !event.shiftKey;
    if (event.key === "ArrowDown") void move(1);
    else if (event.key === "ArrowUp") void move(-1);
    else if (event.key === "PageDown") void jump(active.value + PAGE);
    else if (event.key === "PageUp") void jump(active.value - PAGE);
    else if (event.key === "Home" && ctrl) void jump(0);
    else if (event.key === "End" && ctrl) void jump(options.count() - 1);
    else if (event.key === "Enter") void options.onEnter();
    else return;
    event.preventDefault();
  }

  // Chromium sends a mousemove when the list scrolls or changes under a pointer that did not move. Only a real move
  // takes the highlight, so a row resting under the pointer doesn't steal it from the arrow keys. The first event only
  // notes where the pointer is: a list that opens under a resting pointer keeps its first row.
  let pointer: { x: number; y: number } | undefined;
  /** Put on each row's mousemove, with the row's index. */
  function onHover(index: number, event: MouseEvent) {
    const moved = !!pointer && (pointer.x !== event.clientX || pointer.y !== event.clientY);
    pointer = { x: event.clientX, y: event.clientY };
    if (moved) active.value = index;
  }
  /** Forget where the pointer was: call it when the list opens and when the pointer leaves it. */
  function resetHover() {
    pointer = undefined;
  }

  return { active, move, onKey, onHover, resetHover };
}
