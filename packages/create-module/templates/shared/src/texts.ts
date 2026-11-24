// Every text the page shows, in English and German; Tavora says which language the user uses. Keep both lists in
// step: texts.test.ts checks them.

export const TEXTS = {
  en: {
    connecting: "Connecting to Tavora…",
    notConnected: "Can't reach Tavora. Open this module in Tavora to use it.",
    status: "You're in {workspace}. Clicked {count} times here.",
    add: "Add one",
  },
  de: {
    connecting: "Verbinde mit Tavora …",
    notConnected: "Tavora ist nicht erreichbar. Öffne dieses Modul in Tavora, um es zu nutzen.",
    status: "Du bist in {workspace}. {count}-mal hier geklickt.",
    add: "Eins dazu",
  },
};

export type Language = keyof typeof TEXTS;
export type TextKey = keyof (typeof TEXTS)["en"];

/** One text in `language`, with its {placeholders} filled in; an unknown placeholder stays as it is. */
export function text(language: Language, key: TextKey, params: Record<string, string | number> = {}): string {
  return TEXTS[language][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
}
