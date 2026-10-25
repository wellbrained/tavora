// The Whiteboard's texts in English and German, like the other official modules. Keys are flat.

export const en = {
  loading: "Loading the whiteboard…",
  retry: "Try again",
  "empty.hint": "Pick a tool above and start drawing",
  connectError: "Can't connect to Tavora. {error}",
  boardWord: "Board",
  "board.switch": "Boards",
  "board.new": "New board",
  "board.rename": "Rename",
  "board.renameLabel": "Board name",
  "board.delete": "Delete board",
  "board.current": "Current board",
  "undo.deleted": "Deleted “{name}”",
  "undo.undo": "Undo",
  "undo.dismiss": "Dismiss",
  "save.saving": "Saving…",
  "save.saved": "Saved",
  "save.error": "Could not save",
  "image.lock": "Lock images",
  "image.unlock": "Unlock images",
  "image.lockHint": "Locked images stay put while you draw on top of them",
  "image.unlockHint": "Unlock images to move or resize them",
  "image.lockOne": "Lock this image",
  "image.unlockOne": "Unlock this image",
  "image.unsupported": "Images of this kind ({type}) can't be saved on a board. Use PNG, JPEG, GIF or WebP.",
  "image.failed": "Could not save an image: {error}",
  "size.warn": "This board is getting full ({used} of {max}). Remove some drawings.",
  "size.full": "This board is too big to save ({used} of {max}). Remove some drawings.",
  "copy.button": "Copy as image",
  "copy.hint": "Copies the selection, or the whole board, to paste anywhere (Shift+Alt+C)",
  "copy.board": "Copied the board as an image",
  "copy.selection": "Copied the selection as an image",
  "copy.slow": "Making the image took too long to copy. Select a smaller part and try again.",
  "copy.tooBig": "The image is too big to copy. Select a smaller part and try again.",
  "copy.failed": "Could not copy the image: {error}",
  "savePicture.button": "Save as image",
  "savePicture.hint": "Saves the selection, or the whole board, as an image",
  "savePicture.board": "Saved the board as “{name}”",
  "savePicture.selection": "Saved the selection as “{name}”",
  "savePicture.failed": "Could not save the image: {error}",
  "clear.button": "Clear board",
  "clear.hint": "Takes everything off this board. Undo brings it back.",
  "clear.done": "Cleared the board",
  "toolbar.bottom": "Toolbar at the bottom",
  "toolbar.top": "Toolbar at the top",
  "palette.title": "Style",
  "palette.color": "Color",
  "palette.more": "More options",
  "palette.less": "Fewer options",
  "palette.move": "Drag to move the palette. Double-click to put it back.",
  "palette.collapse": "Fold the palette away",
  "palette.expand": "Show the palette",
} as const;

export const de: Record<keyof typeof en, string> = {
  loading: "Whiteboard wird geladen…",
  retry: "Nochmal versuchen",
  "empty.hint": "Wähle oben ein Werkzeug und leg los",
  connectError: "Keine Verbindung zu Tavora. {error}",
  boardWord: "Tafel",
  "board.switch": "Tafeln",
  "board.new": "Neue Tafel",
  "board.rename": "Umbenennen",
  "board.renameLabel": "Name der Tafel",
  "board.delete": "Tafel löschen",
  "board.current": "Aktuelle Tafel",
  "undo.deleted": "„{name}“ gelöscht",
  "undo.undo": "Rückgängig",
  "undo.dismiss": "Schließen",
  "save.saving": "Speichere…",
  "save.saved": "Gespeichert",
  "save.error": "Konnte nicht gespeichert werden",
  "image.lock": "Bilder sperren",
  "image.unlock": "Bilder entsperren",
  "image.lockHint": "Gesperrte Bilder bleiben an ihrem Platz, während du darauf zeichnest",
  "image.unlockHint": "Bilder entsperren, um sie zu verschieben oder ihre Größe zu ändern",
  "image.lockOne": "Dieses Bild sperren",
  "image.unlockOne": "Dieses Bild entsperren",
  "image.unsupported": "Bilder dieser Art ({type}) können auf einer Tafel nicht gespeichert werden. Nutze PNG, JPEG, GIF oder WebP.",
  "image.failed": "Ein Bild konnte nicht gespeichert werden: {error}",
  "size.warn": "Diese Tafel wird voll ({used} von {max}). Entferne einige Zeichnungen.",
  "size.full": "Diese Tafel ist zu groß zum Speichern ({used} von {max}). Entferne einige Zeichnungen.",
  "copy.button": "Als Bild kopieren",
  "copy.hint": "Kopiert die Auswahl, oder die ganze Tafel, zum Einfügen überall (Umschalt+Alt+C)",
  "copy.board": "Tafel als Bild kopiert",
  "copy.selection": "Auswahl als Bild kopiert",
  "copy.slow": "Das Bild zu erstellen hat zu lange gedauert. Wähle einen kleineren Teil aus und versuch es noch einmal.",
  "copy.tooBig": "Das Bild ist zu groß zum Kopieren. Wähle einen kleineren Teil aus und versuch es noch einmal.",
  "copy.failed": "Das Bild konnte nicht kopiert werden: {error}",
  "savePicture.button": "Als Bild speichern",
  "savePicture.hint": "Speichert die Auswahl, oder die ganze Tafel, als Bild",
  "savePicture.board": "Tafel als „{name}“ gespeichert",
  "savePicture.selection": "Auswahl als „{name}“ gespeichert",
  "savePicture.failed": "Das Bild konnte nicht gespeichert werden: {error}",
  "clear.button": "Tafel leeren",
  "clear.hint": "Nimmt alles von dieser Tafel. Rückgängig holt es zurück.",
  "clear.done": "Tafel geleert",
  "toolbar.bottom": "Werkzeugleiste unten",
  "toolbar.top": "Werkzeugleiste oben",
  "palette.title": "Stil",
  "palette.color": "Farbe",
  "palette.more": "Weitere Optionen",
  "palette.less": "Weniger Optionen",
  "palette.move": "Ziehen, um die Palette zu verschieben. Doppelklick setzt sie zurück.",
  "palette.collapse": "Palette einklappen",
  "palette.expand": "Palette ausklappen",
};

export type MessageKey = keyof typeof en;
export type Language = "en" | "de";

let language: Language = "en";

export function setLanguage(code: string): void {
  language = code.toLowerCase().startsWith("de") ? "de" : "en";
}

export function currentLanguage(): Language {
  return language;
}

/** A text in the current language, with {name} placeholders filled in. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text = (language === "de" ? de : en)[key];
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
