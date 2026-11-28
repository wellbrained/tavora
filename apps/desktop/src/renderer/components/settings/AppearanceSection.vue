<script setup lang="ts">
// Settings > Appearance: pick a style (how Tavora is built: shapes, depth, fonts), then an installed theme and its
// variation (the colours). The theme
// choice is a dropdown whose rows show a small preview of each theme in its own
// colours, so a theme can be judged before it is picked; picking applies it at once, and
// Reset always goes back to the Tavora default. The font list shows each font in itself,
// and a pick changes the font everywhere at once. Below are how text and tabs
// look, and the user's own themes.
import { CopyPlus, FolderOpen, RefreshCw } from "@lucide/vue";
import { computed } from "vue";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@tavora/official-ui/components/ui/select";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@tavora/official-ui/lib/utils";
import type { HostViewState, StyleView, ThemeVariationView, ThemeView } from "../../../shared/host-api";
import { fontFamily, UI_FONTS, uiFont } from "../../../shared/ui-fonts";
import { act, state, tryToasts } from "../../host";
import { hasMessageIn } from "../../../shared/i18n-core";
import { en } from "../../../shared/locales/en";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";
import StylePreview from "./StylePreview.vue";
import ThemePreview from "./ThemePreview.vue";

defineProps<{ highlight: string | null }>();

const appearance = computed(() => state.value!.appearance);

/** The style everything else on this page builds on. Classic is Tavora's own look, the only one with panel styles. */
const CLASSIC = "tavora.classic";
const activeStyle = computed(() => appearance.value.styles.find((style) => style.id === appearance.value.styleId));
const classic = computed(() => appearance.value.styleId === CLASSIC);
function pickStyle(id: string) {
  if (id !== appearance.value.styleId) void act({ type: "set-style", styleId: id });
}
/** Tavora's own styles have their name and line in both languages; another style shows what its file says. */
function styleText(style: StyleView, part: "name" | "description"): string {
  const key = `settings.style.${style.id.replace("tavora.", "")}.${part}`;
  return style.provenance === "official" && ["tavora.classic", "tavora.hardware", "tavora.glass"].includes(style.id)
    ? t(key as Parameters<typeof t>[0])
    : (part === "name" ? style.name : (style.description ?? ""));
}
/** Tavora's own themes have their line in both languages; another theme shows what its file says. */
function themeAbout(theme: { id: string; provenance: "official" | "local"; description: string | null }): string {
  const key = `themeAbout.${theme.id.replace("tavora.", "")}`;
  return theme.provenance === "official" && hasMessageIn(en, key) ? t(key) : (theme.description ?? "");
}
/** The style's own themes first (under its name), then all the others. */
const themeGroups = computed(() => {
  const own = new Set(activeStyle.value?.themes ?? []);
  const first = appearance.value.themes.filter((theme) => own.has(theme.id));
  const rest = appearance.value.themes.filter((theme) => !own.has(theme.id));
  return first.length ? [{ label: activeStyle.value ? t("settings.theme.forStyle", { style: styleText(activeStyle.value, "name") }) : "", themes: first }, { label: t("settings.theme.allThemes"), themes: rest }] : [{ label: "", themes: rest }];
});
const active = computed(() => appearance.value.themes.find((theme) => theme.id === appearance.value.themeId));
/** Official and Local tags only when the list has both; on every card they would say nothing. */
const mixedThemes = computed(() => new Set(appearance.value.themes.map((theme) => theme.provenance)).size > 1);

/** The variation a card previews: the one with the active variation's id (so Light shows Light), otherwise the theme's first. */
function previewOf(theme: ThemeView): ThemeVariationView {
  return theme.variations.find((item) => item.id === appearance.value.variationId) ?? theme.variations[0]!;
}

/** The colours a style shows in the list: its own first theme (what it starts with), in the variation shown now. */
function styleVariation(style: StyleView): ThemeVariationView | undefined {
  const own = appearance.value.themes.find((theme) => style.themes.includes(theme.id));
  return own ? previewOf(own) : undefined;
}

function pickId(id: string) {
  const theme = appearance.value.themes.find((item) => item.id === id);
  if (!theme || theme.id === appearance.value.themeId) return;
  // Keep the same kind of variation (say Light) when the new theme has one.
  const variation = theme.variations.find((item) => item.id === appearance.value.variationId) ?? theme.variations[0]!;
  void act({ type: "set-theme", themeId: theme.id, variationId: variation.id });
}

// The interface font; each row of the list is written in its own font. "style" keeps the style's font.
const font = computed({
  get: () => appearance.value.fontOverride ?? "style",
  set: (id: string) => void act({ type: "set-font", font: id === "style" ? null : id }),
});
const fontInUse = computed(() => uiFont(appearance.value.font.id));
const styleFont = computed(() => uiFont(activeStyle.value?.font));

const grayscaleText = computed({
  get: () => state.value!.library.grayscaleText,
  set: (enabled: boolean) => void act({ type: "set-grayscale-text", enabled }),
});

const moduleIcons = computed({
  get: () => state.value!.library.moduleIcons,
  set: (enabled: boolean) => void act({ type: "set-module-icons", enabled }),
});

type PanelStyle = HostViewState["library"]["panelStyle"];

const panelStyle = computed({
  get: () => state.value!.library.panelStyle,
  set: (style: PanelStyle) => void act({ type: "set-panel-style", style }),
});
const panelStyleOptions = computed(() =>
  (["classic", "framed", "folders"] as const).map((value) => ({ value, label: t(`settings.panel-style.${value}`), testid: `panel-style-${value}` })),
);

type TabOverflow = HostViewState["library"]["tabOverflow"];

const tabOverflow = computed({
  get: () => state.value!.library.tabOverflow,
  set: (mode: TabOverflow) => void act({ type: "set-tab-overflow", mode }),
});
const tabOverflowOptions = computed(() =>
  (["list", "arrows"] as const).map((value) => ({ value, label: t(`settings.tab-overflow.${value}`), testid: `tab-overflow-${value}` })),
);

type ToastPosition = HostViewState["library"]["toasts"];

// Where toasts show: in every panel, and Tavora's own messages too (they sit above the panels, see main/toast-view.ts).
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
// The user's own corner radius over the style's (in Classic the theme's); "style" keeps that one.
const radius = computed({
  get: () => (appearance.value.radius === null ? "style" : String(appearance.value.radius)),
  set: (value: string) => void act({ type: "set-radius", radius: value === "style" ? null : Number(value) }),
});
/** A saved radius between the steps (6 or 10 from before) stays picked, as its own step. */
const radiusOptions = computed(() => {
  const steps = [0, 4, 8, 12, 16];
  const own = appearance.value.radius;
  if (own !== null && !steps.includes(own)) steps.push(own);
  return [
    { value: "style", label: t("settings.corner-radius.style"), testid: "radius-style" },
    ...steps.sort((a, b) => a - b).map((px) => ({ value: String(px), label: `${px}`, testid: `radius-${px}` })),
  ];
});

const showVariation = computed(() => {
  const all = active.value?.variations ?? [];
  return all.length > new Set(all.map((item) => item.mode)).size;
});
</script>

<template>
  <SettingGroup>
    <SettingRow :label="t('settings.style.label')" :description="t('settings.style.description')" setting="style" :highlighted="highlight === 'style'">
      <!-- Like the theme: closed it shows the style in use, open it lists every style with a picture drawn from its looks. -->
      <Select :model-value="appearance.styleId" @update:model-value="(id) => pickStyle(String(id))">
        <SelectTrigger size="auto" class="w-72" :aria-label="t('settings.style.label')" data-testid="style-select">
          <template #value>
            <StylePreview v-if="activeStyle" :look="activeStyle" :variation="active ? previewOf(active) : undefined" size="sm" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium">{{ activeStyle ? styleText(activeStyle, "name") : "" }}</span>
              <span v-if="activeStyle" class="text-muted-foreground truncate text-xs" :title="styleText(activeStyle, 'description')">{{ styleText(activeStyle, "description") }}</span>
            </span>
          </template>
        </SelectTrigger>
        <SelectContent class="w-[26rem]" align="end" data-testid="styles">
          <SelectItem
            v-for="item in appearance.styles"
            :key="item.id"
            :value="item.id"
            :description="styleText(item, 'description') || undefined"
            class="items-center! gap-3 pr-2"
            :data-testid="`style-${item.id}`"
          >
            <template #thumb><StylePreview :look="item" :variation="styleVariation(item)" size="md" /></template>
            <span class="flex items-center gap-2">
              {{ styleText(item, "name") }}
              <Badge v-if="item.id === appearance.styleId" class="bg-primary/15 text-primary flex-none border-transparent py-0 font-semibold" data-testid="style-in-use">{{
                t("settings.theme.inUse")
              }}</Badge>
              <!-- Only the user's own are tagged: Tavora's are the norm here, and a tag on every row would be noise. -->
              <Badge v-if="item.provenance === 'local'" variant="outline" class="text-muted-foreground flex-none py-0 font-normal" data-testid="style-local">{{ t("common.local") }}</Badge>
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
    <SettingRow
      :label="t('settings.theme.label')"
      :description="t('settings.theme.description')"
      setting="theme"
      :highlighted="highlight === 'theme'"
    >
      <!-- One choice: closed it shows the theme in use, open it lists every theme with a preview in its own colours. -->
      <Select :model-value="appearance.themeId" @update:model-value="(id) => pickId(String(id))">
        <SelectTrigger size="auto" class="w-72" :aria-label="t('settings.theme.label')" data-testid="theme-select">
          <template #value>
            <ThemePreview v-if="active" :variation="previewOf(active)" size="sm" />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium">{{ active?.name }}</span>
              <span v-if="active && themeAbout(active)" class="text-muted-foreground truncate text-xs" :title="themeAbout(active)">{{ themeAbout(active) }}</span>
            </span>
          </template>
        </SelectTrigger>
        <!-- The kit's list hides its scrollbar; this list is long, so it shows one. -->
        <SelectContent class="theme-list max-h-[min(70vh,36rem)] w-[26rem]" align="end" data-testid="themes">
          <SelectGroup v-for="group in themeGroups" :key="group.label">
          <SelectLabel v-if="group.label" :data-testid="`theme-group-${group.label}`">{{ group.label }}</SelectLabel>
          <SelectItem
            v-for="theme in group.themes"
            :key="theme.id"
            :value="theme.id"
            :description="themeAbout(theme) || undefined"
            class="items-center! gap-3 pr-2"
            :data-testid="`theme-${theme.id}`"
          >
            <!-- The theme in use is marked with a tag after its name, not the list's check; the text sits centred on the preview. -->
            <template #thumb><ThemePreview :variation="previewOf(theme)" size="md" /></template>
            <span class="flex items-center gap-2">
              {{ theme.name }}
              <Badge v-if="theme.id === appearance.themeId" class="bg-primary/15 text-primary flex-none border-transparent py-0 font-semibold" data-testid="theme-in-use">{{
                t("settings.theme.inUse")
              }}</Badge>
              <Badge v-if="mixedThemes" variant="outline" :class="cn('flex-none py-0 font-normal', theme.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')">{{
                theme.provenance === "official" ? t("common.official") : t("common.local")
              }}</Badge>
            </span>
          </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingRow>
    <SettingRow :label="t('settings.font.label')" :description="t('settings.font.description')" setting="font" :highlighted="highlight === 'font'">
      <Select v-model="font">
        <SelectTrigger class="w-72" :aria-label="t('settings.font.label')" data-testid="font-select">
          <span class="truncate" :style="{ fontFamily: fontFamily(fontInUse) }">
            <template v-if="appearance.fontOverride === null">{{ t("settings.font.fromStyle") }} <span class="text-muted-foreground">({{ fontInUse.name }})</span></template>
            <template v-else>{{ fontInUse.name }}</template>
          </span>
        </SelectTrigger>
        <SelectContent data-testid="fonts">
          <SelectItem value="style" :description="styleFont.name" :style="{ fontFamily: fontFamily(styleFont) }" data-testid="font-style">
            {{ t("settings.font.fromStyle") }}
          </SelectItem>
          <SelectItem
            v-for="item in UI_FONTS"
            :key="item.id"
            :value="item.id"
            :description="t(`settings.font.hint.${item.id}`)"
            :style="{ fontFamily: fontFamily(item) }"
            :data-testid="`font-${item.id}`"
          >
            {{ item.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
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
      :details="t('settings.theme-variation.details')"
      setting="theme-variation"
      :highlighted="highlight === 'theme-variation'"
    >
      <SegmentedControl v-model="variation" :label="t('settings.theme-variation.label')" :options="variationOptions" />
    </SettingRow>
    <SettingRow
      :label="t('settings.corner-radius.label')"
      :description="t('settings.corner-radius.description')"
      setting="corner-radius"
      :highlighted="highlight === 'corner-radius'"
    >
      <SegmentedControl v-model="radius" :label="t('settings.corner-radius.label')" :options="radiusOptions" />
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('settings.heading.display')">
    <!-- Panel styles belong to Classic; every other style brings its own panels. -->
    <SettingRow
      v-if="classic"
      :label="t('settings.panel-style.label')"
      :description="t('settings.panel-style.description')"
      setting="panel-style"
      :highlighted="highlight === 'panel-style'"
    >
      <SegmentedControl v-model="panelStyle" :label="t('settings.panel-style.label')" :options="panelStyleOptions" />
    </SettingRow>
    <SettingRow
      :label="t('settings.tab-overflow.label')"
      :description="t('settings.tab-overflow.description')"
      setting="tab-overflow"
      :highlighted="highlight === 'tab-overflow'"
    >
      <SegmentedControl v-model="tabOverflow" :label="t('settings.tab-overflow.label')" :options="tabOverflowOptions" />
    </SettingRow>
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
      :details="t('settings.grayscale-text.details')"
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
      :details="t('settings.own-themes.details')"
      setting="own-themes"
      :highlighted="highlight === 'own-themes'"
    >
      <template #below>
        <ul v-if="appearance.problems.length" class="mt-2 flex flex-col gap-1.5" :aria-label="t('settings.appearance.problems')" data-testid="theme-problems">
          <li v-for="problem in appearance.problems" :key="problem.folder" class="text-sm">
            <span class="text-destructive font-medium">{{ problem.folder }}</span>{{ " " }}
            <span class="text-muted-foreground">{{ problem.kind === "needs-newer" && problem.values ? t("settings.appearance.needsNewer", problem.values) : t("settings.appearance.problem", { message: problem.message }) }}</span>
          </li>
        </ul>
        <ul v-if="appearance.hints.length" class="mt-2 flex flex-col gap-1.5" :aria-label="t('settings.appearance.hints')" data-testid="theme-hints">
          <li v-for="hint in appearance.hints" :key="hint.folder" class="text-sm">
            <span class="font-medium">{{ hint.folder }}</span>{{ " " }}
            <span class="text-muted-foreground">{{ t("settings.appearance.hint", { needs: hint.needs }) }}</span>
          </li>
        </ul>
      </template>
      <span class="flex flex-none flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" data-testid="create-starter-theme" @click="act({ type: 'create-starter-theme' })">
          <CopyPlus /> {{ t("settings.appearance.newTheme") }}
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="open-themes-folder" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" @click="act({ type: 'open-themes-folder' })">
          <FolderOpen />
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="reload-themes" :aria-label="t('common.reload')" :title="t('common.reload')" @click="act({ type: 'reload-themes' })"><RefreshCw /></Button>
      </span>
    </SettingRow>
  </SettingGroup>

  <!-- The user's own styles, the same way as their own themes: copy the style in use, change the file, Reload. -->
  <SettingGroup :title="t('settings.heading.ownStyles')">
    <SettingRow
      :label="t('settings.own-styles.label')"
      :description="t('settings.own-styles.description')"
      :details="t('settings.own-styles.details')"
      setting="own-styles"
      :highlighted="highlight === 'own-styles'"
    >
      <template #below>
        <ul v-if="appearance.styleProblems.length" class="mt-2 flex flex-col gap-1.5" :aria-label="t('settings.appearance.styleProblems')" data-testid="style-problems">
          <li v-for="problem in appearance.styleProblems" :key="problem.folder" class="text-sm">
            <span class="text-destructive font-medium">{{ problem.folder }}</span>{{ " " }}
            <span class="text-muted-foreground">{{ t("settings.appearance.problem", { message: problem.message }) }}</span>
          </li>
        </ul>
        <ul v-if="appearance.styleHints.length" class="mt-2 flex flex-col gap-1.5" :aria-label="t('settings.appearance.styleHints')" data-testid="style-hints">
          <li v-for="(hint, index) in appearance.styleHints" :key="`${hint.folder}-${index}`" class="text-sm">
            <span class="font-medium">{{ hint.folder }}</span>{{ " " }}
            <span class="text-muted-foreground">{{ t("settings.appearance.styleHint", { message: hint.message }) }}</span>
          </li>
        </ul>
      </template>
      <span class="flex flex-none flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" data-testid="create-starter-style" @click="act({ type: 'create-starter-style' })">
          <CopyPlus /> {{ t("settings.appearance.newStyle") }}
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="open-styles-folder" :aria-label="t('common.openFolder')" :title="t('common.openFolder')" @click="act({ type: 'open-styles-folder' })">
          <FolderOpen />
        </Button>
        <Button variant="secondary" size="icon-sm" data-testid="reload-styles" :aria-label="t('common.reload')" :title="t('common.reload')" @click="act({ type: 'reload-styles' })"><RefreshCw /></Button>
      </span>
    </SettingRow>
  </SettingGroup>

  <SettingGroup>
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
