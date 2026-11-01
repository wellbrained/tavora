import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import type { CatalogMatch, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { api } from "../host";
import { rankByName } from "./search";

/** How long the user has to stop typing before the Tavora service is asked. */
const ONLINE_DELAY_MS = 250;

export interface GameRow {
  id: string;
  name: string;
}

/**
 * The games for what is typed: the built-in list and the Tavora service's, as one list ranked by how well the
 * name fits ("eld" lists Elden Ring before Battlefield 6), each game once.
 */
export function useGameSearch(query: Ref<string>) {
  const matches = ref<CatalogMatch[]>([]);
  const online = ref<OnlineGame[]>([]);
  const onlineStatus = ref<OnlineSearchResult["status"]>("ok");

  let searchId = 0;
  watch(
    query,
    async (text) => {
      const id = ++searchId;
      const found = await api.searchCatalog(text);
      if (id === searchId) matches.value = found;
    },
    { immediate: true },
  );

  let onlineId = 0;
  let onlineTimer: ReturnType<typeof setTimeout> | undefined;
  watch(query, (text) => {
    clearTimeout(onlineTimer);
    const id = ++onlineId;
    if ([...text.trim()].length < 2) {
      online.value = [];
      onlineStatus.value = "ok";
      return;
    }
    onlineTimer = setTimeout(async () => {
      const result = await api.searchOnline(text);
      if (id !== onlineId) return;
      online.value = result.games;
      onlineStatus.value = result.status;
    }, ONLINE_DELAY_MS);
  });
  onScopeDispose(() => clearTimeout(onlineTimer));

  const rows = computed<GameRow[]>(() => {
    const known = new Set(matches.value.map((match) => match.id));
    return rankByName([...matches.value, ...online.value.filter((game) => !known.has(game.id))], query.value, (row) => row.name);
  });

  /** The input `add-workspace` takes for a row. */
  function addInput(row: GameRow): { catalogId: string } | { online: OnlineGame } {
    if (matches.value.some((match) => match.id === row.id)) return { catalogId: row.id };
    // The online result carries the game's Steam id, which the host needs for its icon.
    return { online: online.value.find((game) => game.id === row.id) ?? { id: row.id, name: row.name, steamAppId: null } };
  }

  return { rows, onlineStatus, addInput };
}
