<script setup lang="ts">
// Settings > Appearance: pick an installed theme and its variation. Each
// card is a small preview of the theme drawn with its own colours, so a
// theme can be judged before it is picked; picking applies it at once, and
// Reset always goes back to the Tavora default.
import { Check, FolderOpen, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemeVariationView, ThemeView } from "../../../shared/host-api";
import { act, state } from "../../host";
import SegmentedControl from "./SegmentedControl.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const appearance = computed(() => state.value!.appearance);
const active = computed(() => appearance.value.themes.find((theme) => theme.id === appearance.value.themeId));

/** The variation a card previews: the active one on the active theme, otherwise the theme's first. */
function previewOf(theme: ThemeView): ThemeVariationView {
  return (theme.id === appearance.value.themeId && theme.variations.find((item) => item.id === appearance.value.variationId)) || theme.variations[0]!;
}

function pick(theme: ThemeView) {
  if (theme.id === appearance.value.themeId) return;
  // Keep the same kind of variation (say OLED) when the new theme has one.
  const variation = theme.variations.find((item) => item.id === appearance.value.variationId) ?? theme.variations[0]!;
  void act({ type: "set-theme", themeId: theme.id, variationId: variation.id });
}

const variation = computed({
  get: () => appearance.value.variationId,
  set: (variationId: string) => void act({ type: "set-theme", themeId: appearance.value.themeId, variationId }),
});
const variationOptions = computed(() => (active.value?.variations ?? []).map((item) => ({ value: item.id, label: item.name, testid: `variation-${item.id}` })));
</script>

<template>
  <h2 class="mb-4 text-xl font-semibold">Appearance</h2>

  <div
    :class="cn('-mx-3 rounded-lg border-b px-3 pt-2 pb-5 transition-colors duration-500', highlight === 'theme' && 'bg-primary/10')"
    data-setting="theme"
  >
    <p class="font-medium">Theme</p>
    <p class="text-muted-foreground mt-1 mb-4">How Tavora looks: its colours and corners. Modules get the same colours.</p>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3" role="group" aria-label="Theme" data-testid="themes">
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
            <span
              :class="cn('flex-none rounded-sm border px-1.5 text-xs', theme.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
              >{{ theme.provenance === "official" ? "Official" : "Local" }}</span
            >
            <Check v-if="theme.id === appearance.themeId" class="text-primary ml-auto size-4 flex-none" :stroke-width="1.5" />
          </span>
          <span v-if="theme.description" class="text-muted-foreground line-clamp-2 text-xs">{{ theme.description }}</span>
          <span v-if="theme.variations.length > 1" class="text-muted-foreground text-xs">{{ theme.variations.map((item) => item.name).join(" · ") }}</span>
        </span>
      </button>
    </div>
  </div>

  <SettingRow
    v-if="variationOptions.length > 1"
    label="Variation"
    :description="`The versions ${active?.name ?? 'this theme'} comes in.`"
    setting="theme-variation"
    :highlighted="highlight === 'theme-variation'"
  >
    <SegmentedControl v-model="variation" label="Variation" :options="variationOptions" />
  </SettingRow>
  <SettingRow
    label="Your own themes"
    description="Put a theme folder with a tavora.theme.json in Tavora's themes folder, then press Reload. A theme is colours only, and it needs enough contrast to be used."
    setting="own-themes"
    :highlighted="highlight === 'own-themes'"
  >
    <span class="flex flex-none gap-2">
      <Button variant="secondary" data-testid="open-themes-folder" @click="act({ type: 'open-themes-folder' })">
        <FolderOpen :stroke-width="1.5" /> Open folder
      </Button>
      <Button variant="secondary" data-testid="reload-themes" @click="act({ type: 'reload-themes' })"><RefreshCw :stroke-width="1.5" /> Reload</Button>
    </span>
  </SettingRow>
  <ul v-if="appearance.problems.length" class="-mt-2 mb-2 flex flex-col gap-1.5 py-2" aria-label="Themes that could not be used" data-testid="theme-problems">
    <li v-for="problem in appearance.problems" :key="problem.folder" class="text-sm">
      <span class="text-destructive font-medium">{{ problem.folder }}</span>
      <span class="text-muted-foreground"> could not be used: {{ problem.message }}.</span>
    </li>
  </ul>
  <SettingRow
    label="Reset to Tavora Default"
    description="Go back to Tavora's own look, whatever theme is active."
    setting="reset-theme"
    :highlighted="highlight === 'reset-theme'"
  >
    <Button variant="secondary" :disabled="appearance.isDefault" data-testid="reset-theme" @click="act({ type: 'reset-theme' })">Reset</Button>
  </SettingRow>
</template>
