// The few words the controls say on their own, such as a dialog's "Close" for screen
// readers. The app and every module set the language they show (createTranslator does it
// for the modules), so these follow it without each caller passing them in.
import { computed, ref } from "vue"

const texts = {
  en: { close: "Close", dismiss: "Dismiss", customColor: "Custom colour", cancel: "Cancel", zoomIn: "Zoom in", zoomOut: "Zoom out", zoomFit: "Fit to view", zoomHint: "Ctrl + scroll to zoom", showMore: "Show more", showLess: "Show less", resetPage: "Reset this page", pageReset: "Page reset", undo: "Undo", autosave: "Changes save as you make them.", saved: "Saved", backdrop: "Preview background", backdropGame: "Game", backdropLight: "Light", backdropDark: "Dark", nameEmpty: "Give it a name.", nameTooLong: "That's too long. {max} characters at most." },
  de: { close: "Schließen", dismiss: "Ausblenden", customColor: "Eigene Farbe", cancel: "Abbrechen", zoomIn: "Vergrößern", zoomOut: "Verkleinern", zoomFit: "Alles zeigen", zoomHint: "Strg + Mausrad zum Zoomen", showMore: "Mehr anzeigen", showLess: "Weniger anzeigen", resetPage: "Diese Seite zurücksetzen", pageReset: "Seite zurückgesetzt", undo: "Rückgängig", autosave: "Änderungen speichern sich sofort.", saved: "Gespeichert", backdrop: "Hintergrund der Vorschau", backdropGame: "Spiel", backdropLight: "Hell", backdropDark: "Dunkel", nameEmpty: "Gib einen Namen ein.", nameTooLong: "Das ist zu lang. Höchstens {max} Zeichen." },
}

const language = ref<keyof typeof texts>("en")

/** Anything but German is English, as in the host. */
export function setUiLanguage(next: string): void {
  language.value = next.toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en"
}

export const uiText = computed(() => texts[language.value])
