import type { IconState } from "./icon-state.ts";
import type { IconEntry, IconStore } from "./icons.ts";

/**
 * What the service serves: the icons that ship with the release, plus the ones
 * approved from users' offers, minus any release icon that was taken down. An
 * approved icon wins over a release icon of the same game, so a replacement
 * approved after a takedown never brings the old one back. An icon open for
 * replacements says so (`open`), so users' apps offer theirs for that game.
 * It reads the state on every call, so an approval or a takedown is live at once.
 */
export function createHostedStore(seed: IconStore, state: IconState): IconStore {
  return {
    list(): IconEntry[] {
      const approved = state.approvedList();
      const replaced = new Set(approved.map((icon) => icon.id));
      const entries = seed.list().filter((entry) => !replaced.has(entry.id) && !state.isHidden(entry.id));
      for (const icon of approved) entries.push({ id: icon.id, names: icon.names, sha256: icon.sha256, size: icon.size });
      const open = state.replaceableIds();
      return entries.map((entry) => (open.has(entry.id) ? { ...entry, open: true as const } : entry)).sort((a, b) => a.id.localeCompare(b.id));
    },
    file(id: string): Uint8Array | null {
      const approved = state.approvedBytes(id);
      if (approved) return approved;
      return state.isHidden(id) ? null : seed.file(id);
    },
  };
}
