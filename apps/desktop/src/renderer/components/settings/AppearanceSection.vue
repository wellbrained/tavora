<script setup lang="ts">
// Settings > Appearance: pick an installed theme and its variation. Each
// card is a small preview of the theme drawn with its own colours, so a
// theme can be judged before it is picked; picking applies it at once, and
// Reset always goes back to the Tavora default. Below are how text and tabs
// look, and the user's own themes.
import { Check, CopyPlus, FolderOpen, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import type { HostViewState, ThemeVariationView, ThemeView } from "../../../shared/host-api";
import { act, state, tryToasts } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const appearance = computed(() => state.value!.appearance);
const active = computed(() => appearance.value.themes.find((theme) => theme.id === appearance.value.themeId));
/** Official and Local tags only when the list has both; on every card they would say nothing. */
const mixedThemes = computed(() => new Set(appearance.value.themes.map((theme) => theme.provenance)).size > 1);

/** The variation a card previews: the one with the active variation's id (so Light shows Light), otherwise the theme's first. */
function previewOf(theme: ThemeView): ThemeVariationView {
  return theme.variations.find((item) => item.id === appearance.value.variationId) ?? theme.variations[0]!;
}

function pick(theme: ThemeView) {
  if (theme.id === appearance.value.themeId) return;
  // Keep the same kind of variation (say Light) when the new theme has one.
  const variation = theme.variations.find((item) => item.id === appearance.value.variationId) ?? theme.variations[0]!;
  void act({ type: "set-theme", themeId: theme.id, variationId: variation.id });
}

const grayscaleText = computed({
  get: () => state.value!.library.grayscaleText,
  set: (enabled: boolean) => void act({ type: "set-grayscale-text", enabled }),
});

const moduleIcons = computed({
  get: () => state.value!.library.moduleIcons,
  set: (enabled: boolean) => void act({ type: "set-module-icons", enabled }),
});

type ToastPosition = HostViewState["library"]["toasts"];

// Where toasts show in every panel; the app's own messages stay at the top, over the toolbar.
const toasts = computed({
  get: () => state.value!.library.toasts,
  set: (position: ToastPosition) => void act({ type: "set-toasts", position }),
});
const toastOptions = computed(() =>
  (["bottom-center", "bottom-right", "top-center"] as const).map((value) => ({ value, label: t(`settings.toasts.${value}`), testid: `toasts-${value}` })),
);

type Mode = "system" | "dark" | "light";

// Light or dark: follow the system (the default), or stay in one. Only the modes the theme comes in are offered.
const mode = computed<Mode>({
  get: () => (appearance.value.followSystem ? "system" : (activeVariationOf(appearance.value.variationId)?.mode ?? "dark")),
  set: (value: Mode) => void act({ type: "set-appearance-mode", mode: value }),
});
function activeVariationOf(id: string): ThemeVariationView | undefined {
  return active.value?.variations.find((item) => item.id === id);
}
const modeOptions = computed(() => {
  const modes = new Set((active.value?.variations ?? []).map((item) => item.mode));
  return [
    { value: "system" as const, label: t("common.followSystem"), testid: "mode-system" },
    ...(modes.has("dark") ? [{ value: "dark" as const, label: t("common.dark"), testid: "mode-dark" }] : []),
    ...(modes.has("light") ? [{ value: "light" as const, label: t("common.light"), testid: "mode-light" }] : []),
  ];
});

// A theme with several versions of one mode (say two dark ones) also gets this choice; picking one stays in that version.
const variation = computed({
  get: () => appearance.value.variationId,
  set: (variationId: string) => void act({ type: "set-theme", themeId: appearance.value.themeId, variationId, fixed: true }),
});
const variationOptions = computed(() => (active.value?.variations ?? []).map((item) => ({ value: item.id, label: item.name, testid: `variation-${item.id}` })));
const showVariation = computed(() => {
  const all = active.value?.variations ?? [];
  return all.length > new Set(all.map((item) => item.mode)).size;
});
</script>

<template>
  <SettingGroup>
    <div
      :class="cn('-mx-5 border-b px-5 pt-4 pb-5 transition-colors duration-500', highlight === 'theme' && 'bg-primary/10')"
      data-setting="theme"
    >
      <p class="font-medium">{{ t("settings.theme.label") }}</p>
      <p class="text-muted-foreground mt-0.5 mb-4 text-sm">{{ t("settings.theme.description") }}</p>
      <!-- Two themes a row at least, three or four when there is room. -->
      <div class="@container">
        <div class="grid grid-cols-2 gap-3 @xl:grid-cols-3 @3xl:grid-cols-4" role="group" :aria-label="t('settings.theme.label')" data-testid="themes">
          <button
            v-for="theme in appearance.themes"
            :key="theme.id"
            type="button"
            :aria-pressed="theme.id === appearance.themeId"
            :class="
              cn(
                'bg-background hover:border-input flex flex-col overflow-hidden rounded-lg border text-left',
                theme.id === appearance.themeId && 'border-primary ring-primary/40 hover:border-primary ring-1',
              )
            "
            :data-testid="`theme-${theme.id}`"
            @click="pick(theme)"
          >
            <!-- The preview: rail, window, a card with text and the primary button, in the theme's colours. -->
            <span class="flex h-24 w-full" :style="{ background: previewOf(theme).colors.background }" aria-hidden="true">
              <span class="flex w-7 flex-none flex-col items-center gap-1.5 pt-2.5" :style="{ background: previewOf(theme).colors.rail }">
                <span class="size-3.5 rounded-[4px]" :style="{ background: previewOf(theme).colors.primary }" />
                <span class="size-3.5 rounded-[4px]" :style="{ background: previewOf(theme).colors.secondary }" />
                <span class="size-3.5 rounded-[4px]" :style="{ background: previewOf(theme).colors.secondary }" />
              </span>
              <span class="flex flex-1 p-2.5">
                <span
                  class="flex flex-1 flex-col gap-1.5 border p-2"
                  :style="{
                    background: previewOf(theme).colors.card,
                    borderColor: previewOf(theme).colors.border,
                    borderRadius: `${previewOf(theme).radius}px`,
                  }"
                >
                  <span class="h-1.5 w-3/4 rounded-full" :style="{ background: previewOf(theme).colors.foreground }" />
                  <span class="h-1.5 w-1/2 rounded-full" :style="{ background: previewOf(theme).colors['muted-foreground'] }" />
                  <span class="mt-auto flex gap-1.5">
                    <span class="h-3.5 w-10" :style="{ background: previewOf(theme).colors.primary, borderRadius: `${previewOf(theme).radius / 2}px` }" />
                    <span class="h-3.5 w-8" :style="{ background: previewOf(theme).colors.secondary, borderRadius: `${previewOf(theme).radius / 2}px` }" />
                  </span>
                </span>
              </span>
            </span>
            <span class="bg-card flex flex-1 flex-col gap-0.5 border-t px-3 py-2.5">
              <span class="flex items-center gap-2">
                <span class="truncate font-medium">{{ theme.name }}</span>
                <Badge v-if="mixedThemes" variant="outline" :class="cn('flex-none font-normal', theme.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')">{{
                  theme.provenance === "official" ? t("common.official") : t("common.local")
                }}</Badge>
                <Check v-if="theme.id === appearance.themeId" class="text-primary ml-auto size-4 flex-none" :stroke-width="1.5" />
              </span>
              <span v-if="theme.description" class="text-muted-foreground line-clamp-2 text-xs">{{ theme.description }}</span>
              <span v-if="theme.variations.length > 1" class="text-muted-foreground text-xs">{{ theme.variations.map((item) => item.name).join(" · ") }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
    <SettingRow
      :label="t('settings.appearance-mode.label')"
      :description="t('settings.appearance-mode.description')"
      setting="appearance-mode"
      :highlighted="highlight === 'appearance-mode'"
    >
      <SegmentedControl v-model="mode" :label="t('settings.appearance-mode.label')" :options="modeOptions" />
    </SettingRow>
    <SettingRow
      v-if="showVariation"
      :label="t('settings.theme-variation.label')"
      :description="t('settings.theme-variation.description', { name: active?.name ?? '' })"
      setting="theme-variation"
      :highlighted="highlight === 'theme-variation'"
    >
      <SegmentedControl v-model="variation" :label="t('settings.theme-variation.label')" :options="variationOptions" />
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('settings.heading.display')">
    <SettingRow
      :label="t('settings.module-icons.label')"
      :description="t('settings.module-icons.description')"
      setting="module-icons"
      :highlighted="highlight === 'module-icons'"
    >
      <Switch v-model="moduleIcons" :aria-label="t('settings.module-icons.label')" data-testid="module-icons" />
    </SettingRow>
    <SettingRow :label="t('settings.toasts.label')" :description="t('settings.toasts.description')" setting="toasts" :highlighted="highlight === 'toasts'">
      <span class="flex flex-none flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" data-testid="try-toasts" @click="tryToasts">{{ t("settings.toasts.try") }}</Button>
        <SegmentedControl v-model="toasts" :label="t('settings.toasts.label')" :options="toastOptions" />
      </span>
    </SettingRow>
    <SettingRow
      :label="t('settings.grayscale-text.label')"
      :description="t('settings.grayscale-text.description')"
      setting="grayscale-text"
      :highlighted="highlight === 'grayscale-text'"
    >
      <Switch v-model="grayscaleText" :aria-label="t('settings.grayscale-text.label')" data-testid="grayscale-text" />
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('settings.heading.ownThemes')">
    <SettingRow
      :label="t('settings.own-themes.label')"
      :description="t('settings.own-themes.description')"
      setting="own-themes"
      :highlighted="highlight === 'own-themes'"
    >
      <template #below>
        <ul v-if="appearance.problems.length" class="mt-2 flex flex-col gap-1.5" :aria-label="t('settings.appearance.problems')" data-testid="theme-problems">
          <li v-for="problem in appearance.problems" :key="problem.folder" class="text-sm">
            <span class="text-destructive font-medium">{{ problem.folder }}</span>{{ " " }}
            <span class="text-muted-foreground">{{ t("settings.appearance.problem", { message: problem.message }) }}</span>
          </li>
        </ul>
      </template>
      <span class="flex flex-none flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" data-testid="create-starter-theme" @click="act({ type: 'create-starter-theme' })">
          <CopyPlus :stroke-width="1.5" /> {{ t("settings.appearance.newTheme") }}
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="open-themes-folder" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" @click="act({ type: 'open-themes-folder' })">
          <FolderOpen :stroke-width="1.5" />
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="reload-themes" :aria-label="t('common.reload')" :title="t('common.reload')" @click="act({ type: 'reload-themes' })"><RefreshCw :stroke-width="1.5" /></Button>
      </span>
    </SettingRow>
    <SettingRow
      :label="t('settings.reset-theme.label')"
      :description="t('settings.reset-theme.description')"
      setting="reset-theme"
      :highlighted="highlight === 'reset-theme'"
    >
      <Button variant="secondary" :disabled="appearance.isDefault" data-testid="reset-theme" @click="act({ type: 'reset-theme' })">{{ t("settings.appearance.reset") }}</Button>
    </SettingRow>
  </SettingGroup>
</template>
