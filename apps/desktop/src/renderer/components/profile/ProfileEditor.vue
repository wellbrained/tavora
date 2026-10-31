<script setup lang="ts">
// Profile dialog > Profile: the name and initials, and where the user stands on the leaderboards they are shown on.
// Name and initials save on their own: on Enter, when a field loses focus and when the dialog closes (`save`, called
// by ProfileDialog). The picture is changed on the avatar beside the menu.
import { computed, onMounted, ref } from "vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Check } from "@lucide/vue";
import type { ProfileRankBoard, ProfileRankPeriod, ProfileRankStanding, ProfileRanksView } from "../../../shared/host-api";
import { intlLocale } from "../../../shared/i18n";
import { act, api, state } from "../../host";
import { language, t } from "../../i18n";
import SettingGroup from "../settings/SettingGroup.vue";
import SettingRow from "../settings/SettingRow.vue";
import { autoInitials } from "./initials";

const MAX_NAME = 32;
const MAX_INITIALS = 3;

const profile = computed(() => state.value!.profile);
/** Name and initials as typed, until saved; ProfileDialog shows them beside the avatar as they are typed. */
const draft = defineModel<{ name: string; initials: string }>("draft", { required: true });
const dirty = computed(() => draft.value.name !== profile.value.name || draft.value.initials !== profile.value.initials);
const saving = ref(false);
/** Shows "Saved" for a moment after a save. */
const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

async function save() {
  if (!dirty.value || saving.value) return;
  saving.value = true;
  const result = await act({ type: "save-profile", name: draft.value.name, initials: draft.value.initials });
  saving.value = false;
  if (!result.ok) return;
  // Main may have tidied the values (spaces in initials, length).
  draft.value = { name: profile.value.name, initials: profile.value.initials };
  saved.value = true;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (saved.value = false), 2000);
}
defineExpose({ save });

/** Where the user stands on the boards they are shown on; null until loaded. All periods come at once. */
const ranks = ref<ProfileRanksView | null>(null);
const ranksLoading = ref(false);
/** The periods to pick, with their names' keys. */
const PERIODS = [
  { value: "day", label: "profile.ranks.period.day" },
  { value: "week", label: "profile.ranks.period.week" },
  { value: "month", label: "profile.ranks.period.month" },
  { value: "year", label: "profile.ranks.period.year" },
  { value: "all", label: "profile.ranks.period.all" },
] as const satisfies readonly { value: ProfileRankPeriod; label: string }[];

async function loadRanks() {
  if (profile.value.ranks.hidden || ranksLoading.value) return;
  ranksLoading.value = true;
  // A failed call reads as offline, so the page never stays on Loading.
  ranks.value = (await api.profileRanks().catch(() => null)) ?? { online: false, signedIn: true, modules: [] };
  ranksLoading.value = false;
}
onMounted(loadRanks);

const showRanks = computed({
  get: () => !profile.value.ranks.hidden,
  set: (on: boolean) =>
    void act({ type: "set-profile-ranks", hidden: !on }).then(() => {
      if (on) void loadRanks();
    }),
});

const number = computed(() => new Intl.NumberFormat(intlLocale(language.value), { maximumFractionDigits: 2 }));

/** The standing in the chosen period, or null where the user has none (a streak board has no "day"). */
function standingOf(board: ProfileRankBoard): ProfileRankStanding | null {
  return board.kind === "streak" && profile.value.ranks.period === "day" ? null : board.periods[profile.value.ranks.period];
}

/** The numbers of a standing in words: a streak's best (and the current one on "All time"), a rate with its games, a value with its unit. */
function numbersOf(board: ProfileRankBoard, standing: ProfileRankStanding): string {
  if (board.kind === "streak") {
    const best = standing.best ?? 0;
    const text = t(board.daily ? "profile.ranks.days" : "profile.ranks.wins", { count: best });
    const current = standing.current ?? 0;
    return profile.value.ranks.period === "all" && current > 0 ? `${text} (${t("profile.ranks.now", { count: current })})` : text;
  }
  const value = number.value.format(standing.value ?? 0);
  if (board.kind === "rate") return `${value} % ${t("profile.ranks.games", { wins: standing.wins ?? 0, games: standing.games ?? 0 })}`;
  return board.unit ? `${value} ${board.unit}` : value;
}
</script>

<template>
  <!-- Enter in a field saves; there is no Save button. -->
  <div>
    <SettingGroup>
      <SettingRow :label="t('profile.name')" :description="t('profile.nameHint')">
        <Input
          v-model="draft.name"
          class="w-64"
          :placeholder="t('profile.namePlaceholder')"
          autocomplete="off"
          spellcheck="false"
          :maxlength="MAX_NAME"
          :aria-label="t('profile.name')"
          data-testid="profile-name"
          @blur="save"
          @keydown.enter.prevent="save"
        />
      </SettingRow>
      <SettingRow :label="t('profile.initials')" :description="t('profile.initialsHint')">
        <Input
          v-model="draft.initials"
          class="w-20 text-center"
          :placeholder="autoInitials(draft.name)"
          autocomplete="off"
          spellcheck="false"
          :maxlength="MAX_INITIALS"
          :aria-label="t('profile.initials')"
          data-testid="profile-initials"
          @blur="save"
          @keydown.enter.prevent="save"
        />
      </SettingRow>
    </SettingGroup>
    <p class="text-muted-foreground mt-2 flex min-h-5 items-center justify-end gap-1 text-xs" role="status" data-testid="profile-status">
      <template v-if="saved && !dirty"><Check class="size-3.5" :stroke-width="2" /> {{ t("profile.saved") }}</template>
    </p>
  </div>

  <!-- Where the user stands on the boards they are shown on. -->
  <SettingGroup :title="t('profile.ranks.title')" data-testid="profile-ranks">
    <SettingRow :label="t('profile.ranks.showLabel')" :description="t('profile.ranks.showHint')">
      <Switch v-model="showRanks" :aria-label="t('profile.ranks.showLabel')" data-testid="profile-ranks-shown" />
    </SettingRow>
    <template v-if="showRanks">
      <SettingRow :label="t('profile.ranks.period')">
        <Select :model-value="profile.ranks.period" @update:model-value="act({ type: 'set-profile-ranks', period: $event as ProfileRankPeriod })">
          <SelectTrigger class="w-40" :aria-label="t('profile.ranks.period')" data-testid="profile-ranks-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="period in PERIODS" :key="period.value" :value="period.value">{{ t(period.label) }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <div class="py-3">
        <p v-if="!ranks" class="text-muted-foreground text-sm">{{ t("profile.ranks.loading") }}</p>
        <p v-else-if="!ranks.signedIn" class="text-muted-foreground text-sm">{{ t("profile.ranks.signedOut") }}</p>
        <p v-else-if="!ranks.online" class="text-muted-foreground text-sm">{{ t("profile.ranks.offline") }}</p>
        <p v-else-if="ranks.modules.length === 0" class="text-muted-foreground text-sm">{{ t("profile.ranks.empty") }}</p>
        <div v-else class="flex flex-col gap-3">
          <div v-for="module in ranks.modules" :key="module.id" class="flex flex-col gap-1">
            <span class="text-muted-foreground truncate text-xs font-semibold">{{ module.name }}</span>
            <div
              v-for="board in module.boards"
              :key="board.id"
              class="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 text-sm last:border-b-0"
              :data-testid="`profile-rank-${module.id}-${board.id}`"
            >
              <span class="min-w-0 truncate">{{ board.name }}</span>
              <span v-if="standingOf(board)" class="flex-none text-right">
                <span class="font-medium">{{ t("profile.ranks.rank", { rank: number.format(standingOf(board)!.rank), of: number.format(standingOf(board)!.of) }) }}</span>
                <span class="text-muted-foreground block text-xs">{{ numbersOf(board, standingOf(board)!) }}</span>
              </span>
              <span v-else class="text-muted-foreground flex-none text-xs">{{ t("profile.ranks.none") }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </SettingGroup>
</template>
