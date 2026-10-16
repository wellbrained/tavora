// The Whiteboard's texts in English and German, like the other official modules. Keys are flat.

export const en = {
  loading: "Loading the whiteboard…",
  connectError: "Could not connect: {error}",
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
  "size.warn": "This board is getting full ({used} of {max}). Remove some drawings.",
  "size.full": "This board is too big to save ({used} of {max}). Remove some drawings.",
} as const;

export const de: Record<keyof typeof en, string> = {
  loading: "Whiteboard wird geladen…",
  connectError: "Verbindung nicht möglich: {error}",
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
  "size.warn": "Diese Tafel wird voll ({used} von {max}). Entferne einige Zeichnungen.",
  "size.full": "Diese Tafel ist zu groß zum Speichern ({used} von {max}). Entferne einige Zeichnungen.",
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
