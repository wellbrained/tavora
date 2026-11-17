import type { LicenceEntry, LicenceList } from "../../../shared/host-api";

export type LicenceGroup = LicenceEntry["group"];
/** The order the page lists them in. */
export const LICENCE_GROUPS: readonly LicenceGroup[] = ["libraries", "fonts", "helper"];

/** The packages whose name, version or licence has every word of the query (any case); all of them for an empty query. Grouped, in the page's order, empty groups left out. */
export function filterLicences(list: LicenceList, query: string): { group: LicenceGroup; entries: LicenceEntry[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (entry: LicenceEntry) => {
    const hay = `${entry.name} ${entry.version} ${entry.license}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  };
  return LICENCE_GROUPS.map((group) => ({ group, entries: list.entries.filter((entry) => entry.group === group && matches(entry)) })).filter((part) => part.entries.length > 0);
}
