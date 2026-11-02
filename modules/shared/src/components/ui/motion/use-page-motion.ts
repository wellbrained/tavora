import type { Ref } from "vue"
import { pointerLed } from "./modality"

const CLASS = "tavora-page-in"

/**
 * The motion for a page that takes the place of another in the same frame (the pages of a settings dialog). The old page
 * is gone at once; call `play()` once the new one is in the DOM and it fades in and settles from 4px below (motion.css,
 * `.tavora-page-in`). It only plays for a pick made with the pointer: whatever a key press starts stays instant, as the
 * motion rules say. The element is the page's holder, which stays put, so nothing is remounted and nothing jumps.
 */
export function usePageMotion(target: Ref<HTMLElement | null | undefined>) {
  function play() {
    const element = target.value
    if (!element || !pointerLed()) return
    element.classList.remove(CLASS)
    // Reading the layout restarts the animation when it is still running from the last pick.
    void element.offsetWidth
    element.classList.add(CLASS)
    const end = (event: Event) => {
      if (event.target !== element) return
      element.classList.remove(CLASS)
      element.removeEventListener("animationend", end)
      element.removeEventListener("animationcancel", end)
    }
    element.addEventListener("animationend", end)
    element.addEventListener("animationcancel", end)
  }

  return { play }
}
