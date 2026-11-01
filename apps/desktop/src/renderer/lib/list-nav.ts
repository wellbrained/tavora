import { nextTick, ref, type Ref } from "vue";

/**
 * Arrow-key navigation for a list while focus stays in a text field
 * (combobox + listbox with aria-activedescendant). The highlighted row wraps
 * around at the ends and scrolls into view; Enter runs `onEnter`.
 */
export function useListNav(options: {
  count: () => number;
  /** The scrolling list element; its row marked aria-selected="true" is scrolled into view. */
  list: Ref<HTMLElement | null>;
  onEnter: () => unknown;
}) {
  const active = ref(0);

  async function move(by: number) {
    const count = options.count();
    if (!count) return;
    active.value = (active.value + by + count) % count;
    await nextTick();
    options.list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  /** Put on the field's keydown. */
  function onKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") void move(1);
    else if (event.key === "ArrowUp") void move(-1);
    else if (event.key === "Enter") void options.onEnter();
    else return;
    event.preventDefault();
  }

  return { active, move, onKey };
}
