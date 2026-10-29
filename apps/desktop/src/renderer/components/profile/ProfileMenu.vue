<script setup lang="ts">
import { Camera, Check, EyeOff, UserRound, X } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, nextTick, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProfileRankBoard, ProfileRankPeriod, ProfileRankStanding, ProfileRanksView } from "../../../shared/host-api";
import { intlLocale } from "../../../shared/i18n";
import { act, api, openSettings, state, useFloating } from "../../host";
import { language, t } from "../../i18n";
import ImageCropDialog from "../ImageCropDialog.vue";
import { autoInitials } from "./initials";
import { readPicture } from "./picture";
import ProfileAvatar from "./ProfileAvatar.vue";
import RailFooterTile from "../RailFooterTile.vue";
import RailTooltip from "../RailTooltip.vue";

// The user's avatar in the rail footer. A click opens a small card above
// it to change the name, initials and picture, with a way to the account in
// Settings. Name and initials save on their own: on Enter, when a field loses
// focus and when the card closes; a picture is kept as soon as its crop is saved.
defineProps<{ expanded: boolean }>();

const MAX_NAME = 32;
const MAX_INITIALS = 3;

const profile = computed(() => state.value!.profile);
const open = ref(false);
/** Name and initials as typed, until saved. */
const draft = ref({ name: "", initials: "" });
const dirty = computed(() => draft.value.name !== profile.value.name || draft.value.initials !== profile.value.initials);
const saving = ref(false);
/** Shows "Saved" for a moment after a save. */
const saved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const fileInput = ref<HTMLInputElement | null>(null);
/** The initials field shows once asked for, or when the user has set their own. */
const editInitials = ref(false);
const initialsWrap = ref<HTMLElement | null>(null);
/** The picked image waiting in the crop dialog. */
const cropping = ref<string | null>(null);

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
  // A failed call reads as offline, so the card never stays on Loading.
  ranks.value = (await api.profileRanks().catch(() => null)) ?? { online: false, signedIn: true, modules: [] };
  ranksLoading.value = false;
}

function setRanksHidden(hidden: boolean) {
  void act({ type: "set-profile-ranks", hidden }).then(() => { if (!hidden) void loadRanks(); });
}

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

const track = useFloating();
function onOpenChange(value: boolean) {
  // Closing keeps what was typed, like leaving a field does.
  if (!value) void save();
  open.value = value;
  track(value);
  if (value) {
    draft.value = { name: profile.value.name, initials: profile.value.initials };
    editInitials.value = Boolean(profile.value.initials.trim());
    saved.value = false;
    void loadRanks();
  }
}

async function showInitials() {
  editInitials.value = true;
  await nextTick();
  initialsWrap.value?.querySelector("input")?.focus();
}

function openAccount() {
  void save();
  open.value = false;
  track(false);
  openSettings({ section: "account" });
}

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

function pickPicture() {
  fileInput.value?.click();
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const picture = file ? await readPicture(file) : null;
  if (!picture) return;
  open.value = false;
  track(false);
  cropping.value = picture;
}

async function savePicture(png: string) {
  const result = await act({ type: "set-profile-picture", png });
  if (result.ok) closeCrop();
}

/** Back to the card, keeping any unsaved name or initials. */
function closeCrop() {
  cropping.value = null;
  open.value = true;
  track(true);
}
</script>

<template>
  <RailTooltip :text="profile.name.trim() || t('profile.label')" :disabled="expanded || open">
  <PopoverRoot :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'group text-muted-foreground hover:text-foreground mx-2 flex items-center gap-2.5 rounded-lg p-1 transition-colors focus-visible:-outline-offset-2 data-[state=open]:text-foreground',
            // Open, the profile is a card of its own at the very bottom.
            expanded && 'bg-card text-foreground hover:bg-accent data-[state=open]:bg-accent rounded-xl border p-[6px] text-left',
          )
        "
        data-rail-item
        data-testid="rail-profile"
        :aria-label="profile.name.trim() ? t('profile.named', { name: profile.name.trim() }) : t('profile.label')"
      >
        <ProfileAvatar v-if="expanded" :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="34" />
        <RailFooterTile v-else>
          <ProfileAvatar :name="profile.name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="40" square />
        </RailFooterTile>
        <span v-if="expanded" class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold">{{ profile.name.trim() || t("profile.label") }}</span>
          <span class="text-muted-foreground truncate text-xs">{{ t("rail.profileHint") }}</span>
        </span>
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="8"
        :collision-padding="8"
        class="profile-card bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 data-[side=top]:slide-in-from-bottom-3 border-primary/30 z-50 w-[300px] origin-(--reka-popover-content-transform-origin) overflow-hidden rounded-xl border shadow-xl shadow-black/40 duration-200"
        data-testid="profile-card"
      >
        <!-- Banner: a blurred copy of the picture, or a warm pattern without one. -->
        <div class="profile-banner relative h-[72px] overflow-hidden" aria-hidden="true">
          <img v-if="profile.pictureUrl" :src="profile.pictureUrl" alt="" class="absolute inset-0 size-full scale-150 object-cover blur-xl brightness-[0.55] saturate-150" />
        </div>

        <div class="flex flex-col gap-4 px-4 pb-4">
          <div class="flex items-end gap-3">
            <!-- The avatar overlaps the banner; removing the picture sits on it. -->
            <div class="profile-pop relative -mt-10 flex-none">
              <button
                type="button"
                class="group/avatar ring-popover focus-visible:outline-ring relative block rounded-full ring-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                data-testid="profile-picture"
                :aria-label="t('profile.changePicture')"
                :title="t('profile.changePicture')"
                @click="pickPicture"
              >
                <ProfileAvatar :name="draft.name" :initials="draft.initials" :picture-url="profile.pictureUrl" :size="80" />
                <span
                  class="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
                >
                  <Camera class="size-6 text-white" :stroke-width="1.5" />
                </span>
              </button>
              <button
                v-if="profile.pictureUrl"
                type="button"
                class="bg-secondary text-muted-foreground hover:bg-destructive ring-popover focus-visible:outline-ring absolute top-0 right-0 grid size-6 place-items-center rounded-full ring-2 transition-colors hover:text-white focus-visible:outline-2"
                data-testid="profile-remove-picture"
                :aria-label="t('profile.removePicture')"
                :title="t('profile.removePicture')"
                @click="act({ type: 'remove-profile-picture' })"
              >
                <X class="size-3.5" :stroke-width="2" />
              </button>
            </div>
            <!-- Kept clear of the banner: the row starts where the banner ends. -->
            <div class="flex min-w-0 flex-1 items-center gap-2 pt-2 pb-1">
              <span :class="cn('truncate text-lg font-semibold', !draft.name.trim() && 'text-muted-foreground')">
                {{ draft.name.trim() || t("profile.yours") }}
              </span>
              <span
                v-if="draft.initials.trim() || autoInitials(draft.name)"
                class="bg-secondary text-primary flex-none rounded-sm px-1.5 py-0.5 text-xs font-semibold"
                :title="t('profile.initials')"
              >
                {{ draft.initials.trim() || autoInitials(draft.name) }}
              </span>
            </div>
          </div>
          <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" data-testid="profile-file" @change="onFile" />

        </div>

        <form class="flex w-full flex-col" @submit.prevent="save">
          <div class="flex gap-2 px-4 pb-2">
            <label class="flex min-w-0 flex-1 flex-col gap-1.5">
              <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("profile.name") }}</span>
              <Input
                v-model="draft.name"
                :placeholder="t('profile.namePlaceholder')"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_NAME"
                data-testid="profile-name"
                @blur="save"
              />
            </label>
            <label v-if="editInitials" ref="initialsWrap" class="flex w-20 flex-none flex-col gap-1.5">
              <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("profile.initials") }}</span>
              <Input
                v-model="draft.initials"
                class="text-center"
                :placeholder="autoInitials(draft.name)"
                autocomplete="off"
                spellcheck="false"
                :maxlength="MAX_INITIALS"
                :title="t('profile.initialsHint')"
                data-testid="profile-initials"
                @blur="save"
              />
            </label>
          </div>
          <!-- Enter in a field submits; there is no Save button. -->
          <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />

          <div class="flex min-h-7 items-center gap-2 px-4 pb-3">
            <Button v-if="!editInitials" type="button" variant="link" size="sm" class="h-auto p-0" data-testid="profile-change-initials" @click="showInitials">
              {{ t("profile.changeInitials") }}
            </Button>
            <span class="text-muted-foreground ml-auto flex items-center gap-1 text-xs" role="status" data-testid="profile-status">
              <template v-if="saved && !dirty"><Check class="size-3.5" :stroke-width="2" /> {{ t("profile.saved") }}</template>
            </span>
          </div>

          <!-- Where the user stands on the boards they are shown on. -->
          <div class="flex flex-col gap-2 border-t px-4 py-3" data-testid="profile-ranks">
            <div v-if="profile.ranks.hidden" class="flex items-center gap-2 text-sm">
              <span class="text-muted-foreground">{{ t("profile.ranks.hidden") }}</span>
              <Button type="button" variant="link" size="sm" class="h-auto p-0" data-testid="profile-ranks-show" @click="setRanksHidden(false)">
                {{ t("profile.ranks.show") }}
              </Button>
            </div>
            <template v-else>
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium tracking-wide uppercase">{{ t("profile.ranks.title") }}</span>
                <Select :model-value="profile.ranks.period" @update:model-value="act({ type: 'set-profile-ranks', period: $event as ProfileRankPeriod })">
                  <SelectTrigger size="sm" class="h-7 w-32 text-xs" :aria-label="t('profile.ranks.period')" data-testid="profile-ranks-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="period in PERIODS" :key="period.value" :value="period.value">{{ t(period.label) }}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="size-7"
                  :aria-label="t('profile.ranks.hide')"
                  :title="t('profile.ranks.hide')"
                  data-testid="profile-ranks-hide"
                  @click="setRanksHidden(true)"
                >
                  <EyeOff :stroke-width="1.5" />
                </Button>
              </div>
              <p v-if="!ranks" class="text-muted-foreground text-sm">{{ t("profile.ranks.loading") }}</p>
              <p v-else-if="!ranks.signedIn" class="text-muted-foreground text-sm">{{ t("profile.ranks.signedOut") }}</p>
              <p v-else-if="!ranks.online" class="text-muted-foreground text-sm">{{ t("profile.ranks.offline") }}</p>
              <p v-else-if="ranks.modules.length === 0" class="text-muted-foreground text-sm">{{ t("profile.ranks.empty") }}</p>
              <div v-else class="flex max-h-36 flex-col gap-2 overflow-y-auto">
                <div v-for="module in ranks.modules" :key="module.id" class="flex flex-col gap-1">
                  <span class="text-muted-foreground truncate text-xs">{{ module.name }}</span>
                  <div
                    v-for="board in module.boards"
                    :key="board.id"
                    class="flex items-baseline justify-between gap-3 text-sm"
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
            </template>
          </div>

          <!-- Footer: the way to the account behind the profile. -->
          <div class="bg-background/50 flex items-center border-t px-2 py-1.5">
            <Button type="button" variant="ghost" size="sm" class="w-full justify-start" data-testid="profile-account" @click="openAccount">
              <UserRound :stroke-width="1.5" /> {{ t("profile.account") }}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
  </RailTooltip>

  <ImageCropDialog :src="cropping" :title="t('onboarding.crop')" round @save="savePicture" @cancel="closeCrop" />
</template>
