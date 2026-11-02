import { ref } from "vue"

/** The keys that move through a group of choices (radios, tiles) instead of choosing on purpose. */
const TRAVEL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"])

export const isTravelKey = (key: string) => TRAVEL_KEYS.has(key)

/**
 * Tells a group of radio-like choices (RadioGroup, StyleTiles) that the choice is moving with the arrow keys, so it
 * can hold its motion: nothing a key press starts animates. Put `travelling` on the group as `data-travel` and the
 * handlers on its root. Space on a choice and every click still animate. The flag ends on key up, on a pointer press
 * and when the focus leaves the group. Focus moving from one choice to the next does not end it: reka moves the focus
 * and only then (a tick later) picks the new choice, so the pick must still find the flag set.
 */
export function useKeyTravel() {
  const travelling = ref(false)
  return {
    travelling,
    onKeydown(event: KeyboardEvent) {
      if (isTravelKey(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) travelling.value = true
    },
    end() {
      travelling.value = false
    },
    /** For `focusout` on the group: ends the travel only when the focus leaves the group, not when it moves inside. */
    onFocusout(event: FocusEvent) {
      const to = event.relatedTarget as Node | null
      if (to && (event.currentTarget as Node | null)?.contains(to)) return
      travelling.value = false
    },
  }
}
