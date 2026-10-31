// The long text of a setting, in a card beside its name (SettingRow, SettingExpand): shown while the pointer rests
// on the name, or the name has keyboard focus. While it is open it counts as an open menu, so module panels
// make way for it.
import { onBeforeUnmount, ref } from "vue";
import { useFloating } from "../../host";

export function useDetails() {
  const open = ref(false);
  const anchor = ref({ left: 0, top: 0, right: 0, bottom: 0 });
  const setFloating = useFloating();
  let delay: ReturnType<typeof setTimeout> | undefined;

  function show(element: Element) {
    clearTimeout(delay);
    delay = setTimeout(() => {
      if (!element.isConnected) return;
      const { left, top, right, bottom } = element.getBoundingClientRect();
      anchor.value = { left, top, right, bottom };
      setFloating(true);
      open.value = true;
    }, 200);
  }
  function hide() {
    clearTimeout(delay);
    open.value = false;
    setFloating(false);
  }
  /** Keyboard focus only: a click on the row is not a request for its details. */
  function focus(event: FocusEvent, element: Element) {
    if ((event.target as Element).matches(":focus-visible")) show(element);
  }
  onBeforeUnmount(() => clearTimeout(delay));
  return { open, anchor, show, hide, focus };
}
