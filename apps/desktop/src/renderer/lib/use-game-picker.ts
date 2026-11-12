import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from "vue";
import type { CatalogMatch, CatalogModuleView, InstalledGameView, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { api, state } from "../host";
import { formatDate, t } from "../i18n";
import {
  buildRows,
  CUSTOM_KEY,
  describeActivity,
  keepActive,
  keepOrder,
  modulesFor,
  optionId,
  playedLately,
  resolveAddInput,
  stepActive,
  withLiveCopies,
  type PickerBadge,
  type PickerItems,
  type PickerLine,
  type PickerRow,
} from "./game-picker";
import { findInstalledGames, lastInstalledGames } from "./installed-games";

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
 * Steam's cover art for these games, by app id: a data address, null for none, not there yet while it is asked for.
 * Each game's art is asked for once.
 */
export function useCoverArt(appids: () => readonly number[]) {
  const art = ref<Record<number, string | null>>({});
  const asked = new Set<number>();
  watch(
    appids,
    async (now) => {
      const missing = now.filter((appid) => !asked.has(appid));
      if (!missing.length) return;
      for (const appid of missing) asked.add(appid);
      const found = await api.gameCovers(missing).catch(() => ({}) as Record<number, string | null>);
      art.value = { ...art.value, ...Object.fromEntries(missing.map((appid) => [appid, found[appid] ?? null])) };
    },
    { immediate: true },
  );
  return art;
}

export interface GamePickerOptions {
  /** Leaves out games the user already has. */
  hideAdded?: boolean;
  /** With nothing typed, the games played lately on this PC show as covers above the list. */
  covers?: boolean;
  /** The list's id (GamePickerList `id`), for the search's aria-activedescendant. */
  listId?: string;
  /** The element that scrolls the list; the highlighted item is kept in view in it. */
  list?: Ref<HTMLElement | null>;
  /** Enter on the highlighted item (a row's key, or CUSTOM_KEY for the typed name). */
  onEnter?: (key: string) => unknown;
  /** The search field, for `keepSearchFocus` and `keysToSearch`; null while it isn't shown. */
  search?: () => HTMLElement | null | undefined;
}

/** A button, a link or a field: what takes the focus and its keys for itself. */
const ownsFocus = (target: EventTarget | null) => target instanceof Element && !!target.closest("button, a, input, textarea, select");
/** Text meant to be selected and copied: a message (kit Notice), or anything marked `select-text`. */
const selectable = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-slot="notice"], .select-text');

/**
 * What the Add a game dialog and the first-run welcome share: the games on this PC (most recently played first),
 * the built-in and online search for what is typed, the typed name as the user's own game, the catalog's modules per
 * game, and the highlight, which goes by key so it stays on the same game while answers come in. What is shown never
 * moves while the same thing is typed: a later answer only adds below it.
 */
export function useGamePicker(query: Ref<string>, options: GamePickerOptions = {}) {
  /** The built-in list's answer, with what it was for: an answer for an older search is not shown. */
  const matches = shallowRef<{ query: string; games: CatalogMatch[] }>({ query: "", games: [] });
  // Plain objects, not reactive ones: a picked result is sent to the main process as it is, and a proxy can't be.
  const online = shallowRef<OnlineGame[]>([]);
  const onlineStatus = ref<OnlineSearchResult["status"]>("ok");
  // The list from the search the app started at launch (or the last time), shown at once while a fresh one loads.
  const found = ref<InstalledGameView[]>(lastInstalledGames() ?? []);
  const installedLoaded = ref(lastInstalledGames() !== null);
  /** The games on this PC, each with the user's copy as the library has it now (the list found may be older). */
  const installed = computed(() => withLiveCopies(found.value, state.value?.library.workspaces ?? {}));
  /** The catalog's modules once they are known (none when it can't be reached). */
  const catalogReady = api
    .catalogForGames()
    .catch(() => null)
    .then((result) => (result?.status === "ok" ? result.modules : []));
  /** The same, or null until they are known. */
  const catalogModules = ref<CatalogModuleView[] | null>(null);
  void catalogReady.then((modules) => (catalogModules.value = modules));

  onMounted(() => {
    void findInstalledGames().then((games) => {
      found.value = games;
      installedLoaded.value = true;
    });
  });

  let searchId = 0;
  watch(
    query,
    async (text) => {
      const id = ++searchId;
      const games = await api.searchCatalog(text).catch(() => [] as CatalogMatch[]);
      if (id === searchId) matches.value = { query: text, games };
    },
    { immediate: true },
  );

  let onlineId = 0;
  let onlineTimer: ReturnType<typeof setTimeout> | undefined;
  watch(query, (text) => {
    clearTimeout(onlineTimer);
    const id = ++onlineId;
    // The old answer goes at once: the new one is added below the rest when it comes, so nothing above it moves.
    online.value = [];
    if ([...text.trim()].length < 2) {
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
  /** The built-in list has answered for what is typed now. */
  const listedNow = computed(() => matches.value.query === query.value);
  const rows = computed<PickerRow[]>(() => {
    const all = buildRows(installed.value, listedNow.value ? matches.value.games : [], online.value, query.value);
    return options.hideAdded ? all.filter((row) => !row.workspaceId) : all;
  });
  // The typed name can be added as the user's own game unless a row is exactly that. It waits for the built-in list
  // (an instant, local answer): shown before it, it would keep its place above the built-in matches and take Enter.
  const custom = computed(() => (name.value && listedNow.value && !rows.value.some((row) => row.name.toLowerCase() === name.value.toLowerCase()) ? name.value : null));

  // Each list below starts from what it showed last (`previous`), so what is shown keeps its place while the same thing
  // is typed (see keepOrder).

  /** With nothing typed: the covers of the games played lately; a cover shown stays, also once its game is added. */
  const covers = computed<PickerRow[]>((previous) => {
    const games = options.covers && !name.value ? playedLately(installed.value, previous?.map((row) => row.key)) : [];
    const byKey = new Map(rows.value.map((row) => [row.key, row]));
    return games.flatMap((game) => byKey.get(game.key) ?? []);
  });
  /** The list under the covers, for what is typed: the rows that aren't a cover, then the typed name as the user's own game. */
  const shownLines = computed<{ name: string; lines: PickerLine[] }>((previous) => {
    const onCover = new Set(covers.value.map((row) => row.key));
    const fresh: PickerLine[] = [...rows.value.filter((row) => !onCover.has(row.key)).map((row) => ({ key: row.key, row })), ...(custom.value ? [{ key: CUSTOM_KEY, row: null }] : [])];
    const lines = previous?.name === name.value ? keepOrder(previous.lines.map((line) => line.key), fresh) : fresh;
    return { name: name.value, lines };
  });
  const lines = computed(() => shownLines.value.lines);

  // ── Cover art ────────────────────────────────────────────────────────
  const coverArt = useCoverArt(() => covers.value.flatMap((row) => (row.installed?.steamAppId == null ? [] : [row.installed.steamAppId])));
  /** A cover's picture: its address, null for none (the game's tile shows), undefined while it is being looked for. */
  const coverOf = (row: PickerRow): string | null | undefined => {
    const appid = row.installed?.steamAppId;
    return appid == null ? null : coverArt.value[appid];
  };

  // ── The highlight ────────────────────────────────────────────────────
  const items = computed<PickerItems>(() => ({ covers: covers.value.map((row) => row.key), rows: lines.value.map((line) => line.key) }));
  /** The highlighted item's key. It stays on the same game while answers come in; only when that game is gone does the first item take it. */
  const active = ref<string | null>(keepActive(items.value, null));
  watch(items, (now) => (active.value = keepActive(now, active.value)));

  async function showActive() {
    await nextTick();
    options.list?.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  /** An Enter is waiting for the built-in list's answer. */
  let entering = false;
  /** Enter picks the highlight; pressed right after typing, once the built-in list has answered, so it picks its top match. */
  async function enter() {
    if (entering) return;
    entering = true;
    if (!listedNow.value) {
      await new Promise<void>((resolve) => {
        const stop = watch(listedNow, (now) => {
          if (!now) return;
          stop();
          resolve();
        });
      });
    }
    entering = false;
    if (active.value !== null) void options.onEnter?.(active.value);
  }

  /** Put on the search field's keydown: arrows move the highlight, Enter picks it. */
  function onKey(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void enter();
      return;
    }
    const next = stepActive(items.value, active.value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    active.value = next;
    void showActive();
  }

  /**
   * Put on the mousedown of what holds the search and the list: a press anywhere in it but a button, a link or a field
   * leaves the focus in the search, so the arrows and Enter keep working after a click on the list's padding, a message
   * or the footer. A press on the list's scrollbar still scrolls.
   */
  function keepSearchFocus(event: MouseEvent) {
    if (!options.search?.() || ownsFocus(event.target) || selectable(event.target)) return;
    const box = options.list?.value;
    if (box && event.target === box && box.offsetWidth > box.clientWidth && event.offsetX >= box.clientWidth) return;
    event.preventDefault();
  }

  /**
   * Put on its keydown: keys pressed while the focus is somewhere else in it (after a scrollbar press, say) go to the
   * search. A shortcut (Ctrl+C on a message's text, say) stays where it is.
   */
  function keysToSearch(event: KeyboardEvent) {
    const search = options.search?.();
    if (!search || ownsFocus(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    search.focus();
    onKey(event);
  }

  /** The search's aria-activedescendant: the highlighted option of the list with `listId`. */
  const activeId = computed(() => (active.value !== null && options.listId ? optionId(options.listId, active.value) : undefined));

  /** What a pick of this key adds: a row's game, or (no row) the typed name; null for a key that is gone. */
  function target(key: string): { row: PickerRow | null; name: string } | null {
    const row = rows.value.find((item) => item.key === key);
    if (row) return { row, name: row.name };
    return key === CUSTOM_KEY && custom.value ? { row: null, name: custom.value } : null;
  }

  /** What add-workspace gets for a pick, and the game its modules are for (see resolveAddInput). */
  const addInput = (game: { row: PickerRow | null; name: string }) => resolveAddInput(game.row, game.name, (text) => api.searchOnline(text));

  const modulesOf = (row: PickerRow | null) => modulesFor(catalogModules.value ?? [], row?.gameId ?? null);
  /** A row's badge and second line, as GamePickerList shows them. */
  const info = (row: PickerRow): PickerBadge => ({ modules: modulesOf(row).length, when: whenOf(row) });

  return { name, lines, covers, custom, installed, installedLoaded, onlineStatus, catalogReady, info, coverOf, active, activeId, onKey, keepSearchFocus, keysToSearch, target, addInput };
}
