// The few words the controls say on their own, such as a dialog's "Close" for screen
// readers. The app and every module set the language they show (createTranslator does it
// for the modules), so these follow it without each caller passing them in.
import { computed, ref } from "vue"

const texts = {
  en: { close: "Close", dismiss: "Dismiss", customColor: "Custom colour", cancel: "Cancel", zoomIn: "Zoom in", zoomOut: "Zoom out", zoomControls: "Zoom", zoomWhole: "Show the whole map", zoomReset: "Back to 100%", zoomPercent: "Back to 100%, now {percent}%", zoomHint: "Ctrl + scroll to zoom", mapGroup: "{count} places, click to zoom in", showMore: "Show more", showLess: "Show less", resetPage: "Reset this page", showList: "Show the list", pageReset: "Page reset", undo: "Undo", undoGone: "Can't undo that anymore", autosave: "Changes save as you make them.", saved: "Saved", overlays: "Overlays", inGame: "In game", onStream: "On stream", statusOn: "On", statusOff: "Off", backdrop: "Preview background", backdropGame: "Game", backdropLight: "Light", backdropDark: "Dark", nameEmpty: "Give it a name.", nameTooLong: "That's too long. {max} characters at most.", closeTab: "Close tab", renameTab: "Rename tab", otBox: "Box", otSize: "Size", otGrow: "Grows with the text", otFixed: "Fixed size", otGrowHint: "Drag a corner on the Overlays page to scale it.", otFixedHint: "The text keeps its size in the box you drag.", otTooLong: "Too long", otTooLongHint: "When the text doesn't fit the box.", otScroll: "Scroll", otShrink: "Shrink", otCut: "Cut off", otSpeed: "Scroll speed", otSpeedHint: "How fast long text runs through.", otSlow: "Slow", otNormal: "Normal", otFast: "Fast", otPause: "Pause", otPauseHint: "Before each round, in seconds.", otPauseOff: "Off", otSoftEdges: "Soft edges", otSoftEdgesHint: "Text fades out at the sides as it runs." },
  de: { close: "Schließen", dismiss: "Ausblenden", customColor: "Eigene Farbe", cancel: "Abbrechen", zoomIn: "Vergrößern", zoomOut: "Verkleinern", zoomControls: "Zoom", zoomWhole: "Ganze Karte zeigen", zoomReset: "Zurück auf 100 %", zoomPercent: "Zurück auf 100 %, jetzt {percent} %", zoomHint: "Strg + Mausrad zum Zoomen", mapGroup: "{count} Orte, zum Vergrößern klicken", showMore: "Mehr anzeigen", showLess: "Weniger anzeigen", resetPage: "Diese Seite zurücksetzen", showList: "Liste zeigen", pageReset: "Seite zurückgesetzt", undo: "Rückgängig", undoGone: "Das lässt sich nicht mehr rückgängig machen", autosave: "Änderungen speichern sich sofort.", saved: "Gespeichert", overlays: "Overlays", inGame: "Im Spiel", onStream: "Im Stream", statusOn: "An", statusOff: "Aus", backdrop: "Hintergrund der Vorschau", backdropGame: "Spiel", backdropLight: "Hell", backdropDark: "Dunkel", nameEmpty: "Gib einen Namen ein.", nameTooLong: "Das ist zu lang. Höchstens {max} Zeichen.", closeTab: "Tab schließen", renameTab: "Tab umbenennen", otBox: "Rahmen", otSize: "Größe", otGrow: "Wächst mit dem Text", otFixed: "Feste Größe", otGrowHint: "Zieh auf der Overlays-Seite an einer Ecke, um es zu skalieren.", otFixedHint: "Der Text behält seine Größe im Rahmen, den du ziehst.", otTooLong: "Zu lang", otTooLongHint: "Wenn der Text nicht in den Rahmen passt.", otScroll: "Laufen", otShrink: "Verkleinern", otCut: "Abschneiden", otSpeed: "Tempo", otSpeedHint: "Wie schnell langer Text durchläuft.", otSlow: "Langsam", otNormal: "Normal", otFast: "Schnell", otPause: "Pause", otPauseHint: "Vor jeder Runde, in Sekunden.", otPauseOff: "Aus", otSoftEdges: "Weiche Ränder", otSoftEdgesHint: "Text blendet beim Laufen an den Seiten aus." },
}

const language = ref<keyof typeof texts>("en")

/** Anything but German is English, as in the host. */
export function setUiLanguage(next: string): void {
  language.value = next.toLowerCase().split(/[-_]/)[0] === "de" ? "de" : "en"
}

export const uiText = computed(() => texts[language.value])

/** The language the controls speak now ("en" or "de"), for numbers they write out. */
export const uiLanguage = computed(() => language.value)
