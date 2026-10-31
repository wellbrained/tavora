// New settings (NEW_SETTINGS in settings-index.ts): the row says New, and its page has a New mark in the menu, until
// the user has looked at that page. What was seen is kept on this PC. On the first run nothing is new: New is for what
// comes later.
import { computed, ref } from "vue";
import { NEW_SETTINGS, SETTING_SECTIONS, menuEntry, type SettingsSection } from "./settings-index";

const KEY = "tavora.settings.seen";

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Unreadable: start over below.
  }
  const all = new Set(NEW_SETTINGS.map(([id]) => id));
  store(all);
  return all;
}

function store(ids: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // No local storage: New shows again next time, which does no harm.
  }
}

const seen = ref(load());

/** The new settings not seen yet, with the menu entry of their page. */
const unseen = computed(() =>
  NEW_SETTINGS.filter(([id]) => !seen.value.has(id)).flatMap(([id]) => {
    const section = SETTING_SECTIONS.find(([setting]) => setting === id)?.[1];
    return section && section !== "account" ? [{ id, section, entry: menuEntry(section) }] : [];
  }),
);

export const isNewSetting = (id: string | undefined): boolean => id !== undefined && unseen.value.some((item) => item.id === id);

/** Whether a menu entry leads to anything new. */
export const hasNewSettings = (entry: SettingsSection): boolean => unseen.value.some((item) => item.entry === entry);

/** The page was looked at: its new settings stop saying New (called when the user leaves it). */
export function markSeen(section: SettingsSection): void {
  const ids = unseen.value.filter((item) => item.section === section).map((item) => item.id);
  if (!ids.length) return;
  const next = new Set([...seen.value, ...ids]);
  seen.value = next;
  store(next);
}
