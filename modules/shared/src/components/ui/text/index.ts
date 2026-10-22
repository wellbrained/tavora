// The few words the controls say on their own, such as a dialog's "Close" for screen
// readers. The app and every module set the language they show (createTranslator does it
// for the modules), so these follow it without each caller passing them in.
import { computed, ref } from "vue"

const texts = {
  en: { close: "Close", zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit to view", zoomHint: "Ctrl + scroll to zoom", showMore: "Show more", showLess: "Show less" },
  de: { close: "Schließen", zoomIn: "Vergrößern", zoomOut: "Verkleinern", zoomFit: "Alles zeigen", zoomHint: "Strg + Mausrad zum Zoomen", showMore: "Mehr anzeigen", showLess: "Weniger anzeigen" },
}

const language = ref<keyof typeof texts>("en")

/** Anything but German is English, as in the host. */
export function setUiLanguage(next: string): void {
  language.value = next.toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en"
}

export const uiText = computed(() => texts[language.value])
