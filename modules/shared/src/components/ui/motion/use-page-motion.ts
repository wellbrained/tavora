import type { Ref } from "vue"
import { pointerLed } from "./modality"

const CLASS = "tavora-page-in"

/**
 * The motion for a page that takes the place of another in the same frame (the pages of a settings dialog). The old page
 * is gone at once; call `play()` once the new one is in the DOM and it fades in and settles from 4px below (motion.css,
 * `.tavora-page-in`). It only plays for a pick made with the pointer a moment ago: whatever a key press starts stays
 * instant, as the motion rules say. The element is the page's holder, which stays put, so nothing is remounted and
 * nothing jumps.
 */
export function usePageMotion(target: Ref<HTMLElement | null | undefined>) {
  /** Stops listening for the end of the animation that is running, so a second pick starts clean. */
  let forget: (() => void) | undefined

  function play() {
    const element = target.value
    if (!element || !pointerLed()) return
    // The animation being restarted ends with a cancel event; without this its old listener would take the class off the new one.
    forget?.()
    element.classList.remove(CLASS)
    // Reading the layout restarts the animation when it is still running from the last pick.
    void element.offsetWidth
    element.classList.add(CLASS)
    const end = (event: Event) => {
      if (event.target !== element) return
      element.classList.remove(CLASS)
      forget?.()
    }
    forget = () => {
      element.removeEventListener("animationend", end)
      element.removeEventListener("animationcancel", end)
      forget = undefined
    }
    element.addEventListener("animationend", end)
    element.addEventListener("animationcancel", end)
  }

  return { play }
}
