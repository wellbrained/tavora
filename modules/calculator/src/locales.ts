// The Calculator's texts in English and German. Keys are flat.
export const en = {
  loading: "Loading…",
  connectError: "Could not connect: {error}",
  saveError: "Could not save your history: {error}",

  "calc.display": "Sum",
  "calc.keypad": "Keypad",
  "calc.equals": "Equals",
  "calc.clear": "Clear",
  "calc.back": "Delete last",
  "calc.plus": "Plus",
  "calc.minus": "Minus",
  "calc.times": "Times",
  "calc.divide": "Divided by",
  "calc.percent": "Percent",
  "calc.open": "Open bracket",
  "calc.close": "Close bracket",
  "calc.point": "Point",

  "error.divide": "Can't divide by 0",
  "error.invalid": "That doesn't add up",
  "error.tooBig": "Too big to show",
  "error.incomplete": "Not finished yet",

  "history.title": "History",
  "history.empty": "Your last results show up here.",
  "history.clear": "Clear history",
  "history.use": "Use {result}",
};

export const de: Record<keyof typeof en, string> = {
  loading: "Lädt…",
  connectError: "Keine Verbindung: {error}",
  saveError: "Verlauf nicht gespeichert: {error}",

  "calc.display": "Rechnung",
  "calc.keypad": "Tasten",
  "calc.equals": "Ergibt",
  "calc.clear": "Löschen",
  "calc.back": "Letzte Taste löschen",
  "calc.plus": "Plus",
  "calc.minus": "Minus",
  "calc.times": "Mal",
  "calc.divide": "Geteilt durch",
  "calc.percent": "Prozent",
  "calc.open": "Klammer auf",
  "calc.close": "Klammer zu",
  "calc.point": "Komma",

  "error.divide": "Durch 0 geht nicht",
  "error.invalid": "Das geht nicht auf",
  "error.tooBig": "Zu groß zum Anzeigen",
  "error.incomplete": "Noch nicht fertig",

  "history.title": "Verlauf",
  "history.empty": "Hier siehst du deine letzten Ergebnisse.",
  "history.clear": "Verlauf löschen",
  "history.use": "{result} nehmen",
};
