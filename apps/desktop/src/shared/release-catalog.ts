/**
 * The 1.0 release catalog: everything Tavora can do, shown in Settings > Patch notes in place of the entry for
 * 1.0.0 (the decision log, 2026-10-15). From 1.0.0 on the earlier entries are gone and a fresh changelog starts
 * above it. Before 1.0.0 nothing here shows.
 *
 * Plain friendly words (CLAUDE.md > Writing): short headings, one short sentence per line, "you" / "du", no
 * inner workings. Keep it to what the app has; a new feature after 1.0 goes into a patch-notes entry instead.
 * Written for node's type stripping too (pnpm release:fold reads CATALOG_VERSION), so no enums.
 */
import type { PatchNote } from "./patch-notes";

/** The version whose patch-notes entry is shown as the catalog. */
export const CATALOG_VERSION = "1.0.0";

export interface CatalogText {
  en: string;
  de: string;
}

export interface CatalogGroup {
  id: string;
  title: CatalogText;
  items: readonly CatalogText[];
}

export const RELEASE_CATALOG: readonly CatalogGroup[] = [
  {
    id: "games",
    title: { en: "Your games", de: "Deine Spiele" },
    items: [
      { en: "Every game gets a workspace of its own, and Tavora brings it back when you switch.", de: "Jedes Spiel hat seinen eigenen Arbeitsbereich, und Tavora holt ihn zurück, wenn du wechselst." },
      { en: "Add a game by name, from this PC or from your Steam library.", de: "Füge ein Spiel per Name, von diesem PC oder aus deiner Steam-Bibliothek hinzu." },
      { en: "A game you're playing shows up in the rail, ready to add.", de: "Ein Spiel, das du gerade spielst, erscheint in der Leiste und lässt sich gleich hinzufügen." },
      { en: "Make a personal workspace for everything that belongs to no game.", de: "Leg einen persönlichen Arbeitsbereich für alles an, was zu keinem Spiel gehört." },
      { en: "Sort games with favorites and folders. Removed ones wait in Trash for 7 days.", de: "Sortiere Spiele mit Favoriten und Ordnern. Entfernte warten 7 Tage im Papierkorb." },
      { en: "Press Ctrl+K to find a game, a module or a setting.", de: "Drück Strg+K, um ein Spiel, ein Modul oder eine Einstellung zu finden." },
    ],
  },
  {
    id: "panels",
    title: { en: "Panels", de: "Panels" },
    items: [
      { en: "Put panels side by side or in tabs, and drag them where you want.", de: "Ordne Panels nebeneinander oder in Tabs an und zieh sie, wohin du willst." },
      { en: "Save layouts by name, and maximize a panel when you need room.", de: "Speichere Layouts unter einem Namen und vergrößere ein Panel, wenn du Platz brauchst." },
      { en: "Panels can float over your game.", de: "Panels können über deinem Spiel schweben." },
      { en: "Choose a panel style: Classic, Framed or Folders.", de: "Wähle einen Panel-Stil: Klassisch, Gerahmt oder Ordner." },
      { en: "Deleted something by mistake? Press Undo or Ctrl+Z.", de: "Aus Versehen gelöscht? Drück auf Rückgängig oder Strg+Z." },
    ],
  },
  {
    id: "tools",
    title: { en: "Tools that come with Tavora", de: "Werkzeuge in Tavora" },
    items: [
      { en: "Notes: write with pictures, pin the important ones and search them all.", de: "Notizen: Schreib mit Bildern, pinne Wichtiges an und durchsuche alles." },
      { en: "To-Dos: sort them into colored groups, with steps and pinned goals.", de: "To-Dos: Sortiere sie in farbige Gruppen, mit Schritten und angepinnten Zielen." },
      { en: "Whiteboard: sketch, add cards and arrows, and draw on screenshots.", de: "Whiteboard: Skizziere, füge Karten und Pfeile hinzu und zeichne auf Screenshots." },
      { en: "PDF Viewer: read guides and look at pictures next to your game.", de: "PDF-Viewer: Lies Anleitungen und sieh dir Bilder neben deinem Spiel an." },
      { en: "Clock & Counter: countdowns, stopwatches and counters, with hotkeys.", de: "Clock & Counter: Countdowns, Stoppuhren und Zähler, mit Hotkeys." },
      { en: "Calculator: quick sums that remember your last results.", de: "Rechner: Schnelle Rechnungen, die sich deine letzten Ergebnisse merken." },
      { en: "System Monitor: see how busy your PC and your connection are.", de: "Systemmonitor: Sieh, wie ausgelastet dein PC und deine Verbindung sind." },
      { en: "Browser: keep guides open in tabs, with ad blocking.", de: "Browser: Halte Guides in Tabs offen, mit Werbeblocker." },
    ],
  },
  {
    id: "overlays",
    title: { en: "In your game and on stream", de: "Im Spiel und im Stream" },
    items: [
      { en: "Show a module's overlay over your game. It stays when you switch windows.", de: "Zeig das Overlay eines Moduls über deinem Spiel. Es bleibt, wenn du das Fenster wechselst." },
      { en: "Place overlays on the Overlay page, for all games or just one.", de: "Platziere Overlays auf der Overlay-Seite, für alle Spiele oder nur eins." },
      { en: "Add a picture of your game to see where everything lands.", de: "Füge ein Bild deines Spiels hinzu, um zu sehen, wo alles landet." },
      { en: "Show overlays in OBS or another streaming app on this PC with a link.", de: "Zeig Overlays in OBS oder einer anderen Streaming-App auf diesem PC, per Link." },
    ],
  },
  {
    id: "modules",
    title: { en: "More modules", de: "Mehr Module" },
    items: [
      { en: "Browse modules other people made, with ratings and reviews.", de: "Stöbere in Modulen von anderen, mit Bewertungen und Rezensionen." },
      { en: "A game's own modules come along when you add it.", de: "Die Module eines Spiels kommen mit, wenn du es hinzufügst." },
      { en: "Ask for a module for a game that has none yet.", de: "Wünsch dir ein Modul für ein Spiel, das noch keins hat." },
      { en: "Modules ask before they use anything, and you can take it back any time.", de: "Module fragen, bevor sie etwas nutzen, und du kannst es jederzeit zurücknehmen." },
      { en: "Updates wait for your OK, or install on their own if you prefer.", de: "Updates warten auf dein OK oder installieren sich selbst, wenn du das willst." },
      { en: "Write to a module's developer, and read their answer in your inbox.", de: "Schreib dem Entwickler eines Moduls und lies die Antwort in deinem Posteingang." },
      { en: "Make your own modules and share them with everyone.", de: "Bau eigene Module und teil sie mit allen." },
    ],
  },
  {
    id: "account",
    title: { en: "Account and cloud copy", de: "Konto und Cloud-Kopie" },
    items: [
      { en: "An account is optional. Sign in with an email code or with Discord.", de: "Ein Konto ist freiwillig. Melde dich mit einem E-Mail-Code oder mit Discord an." },
      { en: "Turn on a cloud copy to get your workspaces back on another PC.", de: "Schalte eine Cloud-Kopie ein, um deine Arbeitsbereiche auf einem anderen PC wiederzuhaben." },
      { en: "Keep it on our server, or in a folder your cloud drive syncs.", de: "Bewahr sie auf unserem Server auf oder in einem Ordner, den dein Cloud-Laufwerk abgleicht." },
      { en: "Only you can read it. Keep your recovery key safe.", de: "Nur du kannst sie lesen. Bewahr deinen Wiederherstellungsschlüssel gut auf." },
      { en: "Tavora keeps backups on this PC too.", de: "Tavora legt auch auf diesem PC Sicherungen an." },
    ],
  },
  {
    id: "look",
    title: { en: "Themes and settings", de: "Designs und Einstellungen" },
    items: [
      { en: "Pick a theme, in light or dark, or let it follow your PC.", de: "Wähl ein Design, hell oder dunkel, oder lass es deinem PC folgen." },
      { en: "Round the corners the way you like, or make a theme of your own.", de: "Runde die Ecken, wie du willst, oder bau dir ein eigenes Design." },
      { en: "Tavora is available in English and German.", de: "Tavora gibt es auf Deutsch und Englisch." },
      { en: "Shortcuts work everywhere in Tavora. Ctrl+/ lists them all.", de: "Tastenkürzel gelten überall in Tavora. Strg+/ listet alle auf." },
    ],
  },
  {
    id: "safety",
    title: { en: "Safe and private", de: "Sicher und privat" },
    items: [
      { en: "Your games, notes and layouts stay on your PC unless you turn something on.", de: "Deine Spiele, Notizen und Layouts bleiben auf deinem PC, es sei denn, du schaltest etwas ein." },
      { en: "Modules only get what you allow. Your sign-ins stay with you.", de: "Module bekommen nur, was du erlaubst. Deine Anmeldungen bleiben bei dir." },
      { en: "Game search and game icons have switches in Settings.", de: "Spielesuche und Spielsymbole haben Schalter in den Einstellungen." },
      { en: "Tavora updates itself in the background and installs when you close it.", de: "Tavora aktualisiert sich im Hintergrund und installiert, wenn du es schließt." },
    ],
  },
];

const parts = (version: string) => version.split(".").map(Number) as [number, number, number];

/** Whether `a` is the same as or newer than `b`; both are major.minor.patch. */
function atLeast(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return true;
}

/**
 * The patch-notes entries to show. Before the app has the 1.0.0 entry, all of them. With it, that entry and the newer
 * ones: the earlier ones are dropped, even where the file still has them. `catalog` is the entry shown as the
 * catalog, or null.
 */
export function visiblePatchNotes(notes: readonly PatchNote[]): { entries: readonly PatchNote[]; catalog: PatchNote | null } {
  const catalog = notes.find((entry) => entry.version === CATALOG_VERSION) ?? null;
  if (!catalog) return { entries: notes, catalog: null };
  return { entries: notes.filter((entry) => atLeast(entry.version, CATALOG_VERSION)), catalog };
}
