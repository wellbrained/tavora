import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { CatalogMatch, CatalogModuleView, InstalledGameView, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { api } from "../host";
import { formatDate, t } from "../i18n";
import { buildRows, describeActivity, modulesFor, type PickerRow } from "./game-picker";

/** How long the user has to stop typing before the Tavora service is asked. */
const ONLINE_DELAY_MS = 250;

/** When a game on this PC was played or installed, in words ("Played yesterday"), or null. */
export function whenOf(row: PickerRow): string | null {
  const activity = row.installed?.activity;
  if (!activity) return null;
  const text = describeActivity(activity, Date.now());
  if ("n" in text) return t(text.key, { n: text.n });
  if ("month" in text) return t(text.key, { month: formatDate(text.month, text.withYear ? { month: "long", year: "numeric" } : { month: "long" }) });
  return t(text.key);
}

/**
 * What the Add a game dialog and the first-run welcome share: the games on this PC (most recently played first),
 * the built-in and online search for what is typed, the typed name as the user's own game, and the catalog's
 * modules per game. `hideAdded` leaves out games the user already has.
 */
export function useGamePicker(query: Ref<string>, { hideAdded = false } = {}) {
  const matches = ref<CatalogMatch[]>([]);
  const online = ref<OnlineGame[]>([]);
  const onlineStatus = ref<OnlineSearchResult["status"]>("ok");
  const installed = ref<InstalledGameView[]>([]);
  const installedLoaded = ref(false);
  /** The catalog's modules, or null until they are known. */
  const catalogModules = ref<CatalogModuleView[] | null>(null);

  onMounted(async () => {
    void api.installedGames().then((games) => {
      installed.value = games;
      installedLoaded.value = true;
    });
    const result = await api.catalogForGames();
    catalogModules.value = result.status === "ok" ? result.modules : [];
  });

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
  onBeforeUnmount(() => clearTimeout(onlineTimer));

  const name = computed(() => query.value.replace(/\s+/g, " ").trim());
  const rows = computed<PickerRow[]>(() => {
    const all = buildRows(installed.value, matches.value, online.value, query.value);
    return hideAdded ? all.filter((row) => !row.workspaceId) : all;
  });
  // The typed name can be added as the user's own game unless a row is exactly that.
  const custom = computed(() => (name.value && !rows.value.some((row) => row.name.toLowerCase() === name.value.toLowerCase()) ? name.value : null));
  const count = computed(() => rows.value.length + (custom.value ? 1 : 0));

  const modulesOf = (row: PickerRow | null) => modulesFor(catalogModules.value ?? [], row?.gameId ?? null);

  return { name, rows, custom, count, installed, installedLoaded, onlineStatus, catalogModules, modulesOf };
}
