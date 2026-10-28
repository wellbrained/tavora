<script setup lang="ts">
// First-run welcome, in place of Home until it is finished or skipped:
// 1) welcome and profile, 2) first games, 3) a few tips. Settings > General
// can show it again.
import { ArrowLeft, Camera, Keyboard, PanelLeft, Plus, Search } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import type { CatalogMatch } from "../../shared/host-api";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import WorkspaceIcon from "../components/WorkspaceIcon.vue";
import ImageCropDialog from "../components/ImageCropDialog.vue";
import { readPicture } from "../components/profile/picture";
import ProfileAvatar from "../components/profile/ProfileAvatar.vue";
import { act, api, dialog, state } from "../host";
import { t } from "../i18n";
import { MOD } from "../shortcuts";

const STEPS = ["you", "games", "tips"] as const;

const view = computed(() => state.value!);
const profile = computed(() => view.value.profile);
// The games added so far: their game workspaces.
const games = computed(() => Object.values(view.value.library.workspaces).filter((workspace) => workspace.kind === "game"));

// Popular games from the built-in list, one click to add. The host leaves out the ones the user has; one added
// here leaves the tiles as soon as its workspace is in the library, so the list is not asked again.
const popular = ref<CatalogMatch[]>([]);
onMounted(async () => (popular.value = await api.popularGames()));
const offered = computed(() => popular.value.filter((game) => !view.value.library.workspaces[game.id]));
/** The tile being added, so a second click does nothing while the host works. */
const adding = ref<string | null>(null);

async function addGame(catalogId: string) {
  if (adding.value) return;
  adding.value = catalogId;
  try {
    await act({ type: "add-workspace", catalogId });
  } finally {
    adding.value = null;
  }
}

const step = ref(0);
/** Which way the steps slide. */
const forward = ref(true);
const name = ref(profile.value.name);
const fileInput = ref<HTMLInputElement | null>(null);
const cropping = ref<string | null>(null);

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  cropping.value = file ? await readPicture(file) : null;
}

async function savePicture(png: string) {
  const result = await act({ type: "set-profile-picture", png });
  if (result.ok) cropping.value = null;
}

async function go(to: number) {
  // The name is kept when leaving the first step, whichever way.
  if (step.value === 0 && name.value !== profile.value.name) {
    const result = await act({ type: "save-profile", name: name.value, initials: profile.value.initials });
    if (!result.ok) return;
  }
  forward.value = to > step.value;
  step.value = to;
}

async function finish() {
  if (step.value === 0) await go(0);
  await act({ type: "set-onboarded", done: true });
}

const tips = computed(() => [
  { icon: PanelLeft, title: t("onboarding.tip.workspaces.title"), text: t("onboarding.tip.workspaces.text") },
  { icon: Search, title: t("onboarding.tip.find.title"), keys: [MOD(), "K"], text: t("onboarding.tip.find.text") },
  { icon: Keyboard, title: t("onboarding.tip.shortcuts.title"), keys: [MOD(), "/"], text: t("onboarding.tip.shortcuts.text", { mod: MOD() }) },
]);
</script>

<template>
  <main class="relative flex h-full flex-col items-center overflow-y-auto px-8 pt-14 pb-8 [@media(max-height:640px)]:pt-10 [@media(max-height:640px)]:pb-4" data-testid="onboarding">
    <!-- Skips the whole intro. The games step has its own Skip for now under Next, so this one steps aside there. -->
    <button
      v-if="step !== 1"
      type="button"
      class="text-muted-foreground hover:text-foreground app-no-drag absolute top-4 right-6 z-10 rounded-md px-2 py-1 text-sm"
      data-testid="onboarding-skip"
      @click="finish"
    >
      {{ t("onboarding.skip") }}
    </button>

    <!-- Step dots -->
    <ol class="mb-10 [@media(max-height:640px)]:mb-5 flex items-center gap-2" :aria-label="t('onboarding.steps')">
      <li v-for="(label, index) in STEPS" :key="label" class="flex items-center gap-2">
        <span
          :class="cn('h-1.5 rounded-full transition-all duration-300', index === step ? 'bg-primary w-8' : index < step ? 'bg-primary/50 w-3' : 'bg-muted w-3')"
          :aria-current="index === step ? 'step' : undefined"
          :aria-label="t(`onboarding.step.${label}`)"
        />
      </li>
    </ol>

    <Transition :name="forward ? 'step-forward' : 'step-back'" mode="out-in">
      <!-- 1: welcome and profile -->
      <section v-if="step === 0" key="you" class="flex w-full max-w-[420px] flex-col items-center text-center">
        <img class="mb-6 [@media(max-height:640px)]:hidden" src="/brand/emblem-240.png" alt="" width="93" height="100" draggable="false" />
        <h1 class="text-3xl font-semibold">{{ t("welcome.title.new") }}</h1>
        <p class="text-muted-foreground mt-2 mb-8 [@media(max-height:640px)]:mb-5">{{ t("onboarding.tagline") }}</p>

        <button
          type="button"
          class="group/avatar focus-visible:outline-ring relative mb-5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4"
          data-testid="onboarding-picture"
          :aria-label="t('onboarding.picture')"
          :title="t('onboarding.picture')"
          @click="fileInput?.click()"
        >
          <ProfileAvatar :name="name" :initials="profile.initials" :picture-url="profile.pictureUrl" :size="96" />
          <span class="bg-primary text-primary-foreground ring-background absolute right-0 bottom-0 grid size-8 place-items-center rounded-full ring-4">
            <Camera class="size-4" :stroke-width="2" />
          </span>
        </button>
        <input ref="fileInput" type="file" class="hidden" accept="image/png,image/jpeg,image/webp" @change="onFile" />

        <Input
          v-model="name"
          class="h-10 max-w-72 text-center text-base"
          :placeholder="t('onboarding.name')"
          :aria-label="t('onboarding.name')"
          autocomplete="off"
          spellcheck="false"
          maxlength="32"
          data-testid="onboarding-name"
          @keydown.enter="go(1)"
        />
        <p class="text-muted-foreground mt-2 text-xs">{{ t("onboarding.nameHint") }}</p>

        <Button class="mt-8 min-w-32" data-testid="onboarding-next" @click="go(1)">{{ t("common.next") }}</Button>
      </section>

      <!-- 2: first games -->
      <section v-else-if="step === 1" key="games" class="flex w-full max-w-[560px] flex-col items-center text-center">
        <h1 class="text-3xl font-semibold">{{ t("onboarding.games.title") }}</h1>
        <p class="text-muted-foreground mt-2 mb-8">{{ t("onboarding.games.sub") }}</p>

        <!-- The games picked so far, with the look they have on the rail. -->
        <ul v-if="games.length" class="mb-6 flex flex-wrap justify-center gap-3" :aria-label="t('onboarding.games.yours')" data-testid="onboarding-games">
          <li v-for="game in games" :key="game.id" class="flex w-20 flex-col items-center gap-1.5">
            <WorkspaceIcon :workspace="game" :size="56" />
            <span class="max-w-full truncate text-xs">{{ game.name }}</span>
          </li>
        </ul>

        <!-- Popular games, one click each, and the way to every other game. -->
        <ul class="grid w-full grid-cols-3 gap-2" :aria-label="t('onboarding.games.popular')" data-testid="onboarding-popular">
          <li v-for="game in offered" :key="game.id">
            <Button
              variant="outline"
              class="h-12 w-full justify-start gap-2 px-3 text-sm font-normal"
              :disabled="adding !== null"
              :data-testid="`onboarding-game-${game.id}`"
              @click="addGame(game.id)"
            >
              <Plus class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" />
              <span class="truncate">{{ game.name }}</span>
            </Button>
          </li>
          <li>
            <Button
              variant="outline"
              class="text-muted-foreground h-12 w-full justify-start gap-2 border-dashed px-3 text-sm font-normal"
              data-testid="onboarding-add-game"
              @click="dialog = { kind: 'add-game' }"
            >
              <Search class="size-4 flex-none" :stroke-width="1.5" />
              <span class="truncate">{{ t("onboarding.games.find") }}</span>
            </Button>
          </li>
        </ul>
        <!-- Steam import: an "Import from Steam" button goes here once it exists. -->

        <div class="mt-8 flex items-center gap-3">
          <Button variant="ghost" @click="go(0)"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
          <Button class="min-w-32" :disabled="!games.length" data-testid="onboarding-next" @click="go(2)">{{ t("common.next") }}</Button>
        </div>
        <Button variant="link" class="text-muted-foreground mt-3 h-auto p-0 text-sm" data-testid="onboarding-skip-games" @click="go(2)">
          {{ t("onboarding.games.skip") }}
        </Button>
      </section>

      <!-- 3: tips -->
      <section v-else key="tips" class="flex w-full max-w-[560px] flex-col items-center text-center">
        <h1 class="text-3xl font-semibold">{{ t("onboarding.tips.title") }}</h1>
        <p class="text-muted-foreground mt-2 mb-8">{{ t("onboarding.tips.sub") }}</p>

        <ul class="flex w-full flex-col gap-2 text-left">
          <li v-for="tip in tips" :key="tip.title" class="bg-card flex items-center gap-4 rounded-lg border p-4">
            <span class="bg-primary/15 text-primary grid size-10 flex-none place-items-center rounded-lg">
              <component :is="tip.icon" class="size-5" :stroke-width="1.5" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="font-medium">{{ tip.title }}</span>
              <span class="text-muted-foreground text-sm">{{ tip.text }}</span>
            </span>
            <span v-if="tip.keys" class="flex flex-none gap-1">
              <Kbd v-for="key in tip.keys" :key="key">{{ key }}</Kbd>
            </span>
          </li>
        </ul>

        <div class="mt-8 flex items-center gap-3">
          <Button variant="ghost" @click="go(1)"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
          <Button class="min-w-32" data-testid="onboarding-done" @click="finish">{{ t("onboarding.done") }}</Button>
        </div>
      </section>
    </Transition>

    <ImageCropDialog :src="cropping" :title="t('onboarding.crop')" round @save="savePicture" @cancel="cropping = null" />
  </main>
</template>

<style scoped>
.step-forward-enter-active,
.step-forward-leave-active,
.step-back-enter-active,
.step-back-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.step-forward-enter-from,
.step-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.step-forward-leave-to,
.step-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
</style>
