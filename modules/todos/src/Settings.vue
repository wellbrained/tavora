<script setup lang="ts">
// To-Dos' settings, shown while the panel is open as a dialog (panel.openDialog): how the panel shows to-dos,
// then the live view over the game in three pages. Every change applies at once; previews show the real thing.
import { LayoutList, PanelsTopLeft, Paintbrush, Type } from "@lucide/vue";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { ModuleSettings, SettingsPage, SettingsPreview, SettingsRow, SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { SliderField } from "@tavora/official-ui/components/ui/slider";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { computed, onMounted, ref, watch } from "vue";
import { t } from "./i18n";
import {
  fontStack,
  LIVE_COLORS,
  LIVE_DEFAULTS,
  LIVE_FONTS,
  LIVE_HEADERS,
  LIVE_RANGE,
  LIVE_SIZES,
  PANEL_LOOK_DEFAULTS,
  PANEL_SIZES,
  type LiveHeaders,
  type LiveLook,
  type LiveSize,
  type LiveState,
  type PanelLook,
} from "./live";
import { drawPlate } from "./plate";

const props = defineProps<{ state: LiveState; savedAt?: number }>();
const look = defineModel<LiveLook>("look", { required: true });
const panelLook = defineModel<PanelLook>("panelLook", { required: true });

type Page = "panel" | "text" | "background" | "content";
const page = ref<Page>("panel");
const groups = computed(() => [
  { items: [{ id: "panel", label: t("settings.panel"), icon: PanelsTopLeft, testid: "settings-page-panel" }] },
  {
    heading: t("settings.overlays"),
    items: [
      { id: "text", label: t("live.cat.text"), icon: Type, testid: "settings-page-text" },
      { id: "background", label: t("live.cat.background"), icon: Paintbrush, testid: "settings-page-background" },
      { id: "content", label: t("live.cat.content"), icon: LayoutList, testid: "settings-page-content" },
    ],
  },
]);

/** What each live view page owns, so Reset this page puts back only those. */
const PAGE_KEYS: Record<Exclude<Page, "panel">, (keyof LiveLook)[]> = {
  text: ["font", "size", "bold", "color", "outline"],
  background: ["backgroundColor", "background", "padding"],
  content: ["headers", "showFinished"],
};

function reset(id: string): () => void {
  if (id === "panel") {
    const before = panelLook.value;
    panelLook.value = { ...PANEL_LOOK_DEFAULTS };
    return () => (panelLook.value = before);
  }
  const before = look.value;
  const defaults = Object.fromEntries(PAGE_KEYS[id as Exclude<Page, "panel">].map((key) => [key, LIVE_DEFAULTS[key]])) as Partial<LiveLook>;
  look.value = { ...look.value, ...defaults } as LiveLook;
  return () => (look.value = before);
}

const COLOR_NAMES = ["white", "yellow", "orange", "red", "pink", "violet", "blue", "teal", "green", "black"];
const colorLabels = computed(() => COLOR_NAMES.map((name) => t(`color.${name}` as "color.red")));
const SIZE_OPTIONS = (Object.keys(LIVE_SIZES) as LiveSize[]).map((size) => ({ value: size, label: size.toUpperCase(), testid: `size-${size}` }));
/** Segments that share the control column evenly. */
const fill = "w-full min-w-0 [&>*]:flex-1 [&>*]:px-0";

function set<K extends keyof LiveLook>(key: K, value: LiveLook[K] | undefined) {
  if (value !== undefined) look.value = { ...look.value, [key]: value };
}
function setPanel<K extends keyof PanelLook>(key: K, value: PanelLook[K] | undefined) {
  if (value !== undefined) panelLook.value = { ...panelLook.value, [key]: value };
}

/** A few of the user's own to-dos for the panel preview. */
const sample = computed(() => props.state.rows.filter((row) => row.kind === "task").slice(0, 4));
const panelStyle = computed(() => {
  const [size, leading] = PANEL_SIZES[panelLook.value.size];
  return { fontFamily: fontStack(panelLook.value.font), fontSize: `${size}px`, lineHeight: `${leading}px` };
});

const plate = ref<HTMLElement | null>(null);
const draw = () => plate.value && drawPlate(plate.value, props.state);
onMounted(() => void document.fonts.ready.then(draw));
watch([() => props.state, plate], draw, { deep: true });
</script>

<template>
  <ModuleSettings v-model:page="page" :groups="groups" :label="t('settings.title')" :reset="reset" :saved-at="savedAt" data-testid="todos-settings">
    <SettingsPage v-if="page === 'panel'" :title="t('settings.panel')" :description="t('settings.panelIntro')">
      <template #preview>
        <SettingsPreview kind="panel" :label="t('settings.panelPreview')">
          <div class="bg-card text-card-foreground w-80 rounded-lg border p-2 shadow-lg" :style="panelStyle" data-testid="panel-preview">
            <p v-if="!sample.length" class="text-muted-foreground px-1 py-1">{{ t("live.previewEmpty") }}</p>
            <div v-for="(row, index) in sample" :key="index" class="flex items-center gap-2 px-1 py-1">
              <span :class="['size-4 flex-none rounded-full border-[1.5px]', row.kind === 'task' && row.done ? 'border-primary bg-primary' : 'border-muted-foreground/60']" />
              <span :class="['truncate', row.kind === 'task' && row.done && 'text-muted-foreground line-through']">{{ row.text }}</span>
            </div>
          </div>
        </SettingsPreview>
      </template>
      <SettingsSection :title="t('live.cat.text')">
        <SettingsRow :label="t('live.font')">
          <Select :model-value="panelLook.font" @update:model-value="setPanel('font', $event as PanelLook['font'])">
            <SelectTrigger class="w-full" :aria-label="t('live.font')" data-testid="panel-font"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="font in LIVE_FONTS" :key="font.id" :value="font.id" :style="{ fontFamily: font.stack }">{{ font.name }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow :label="t('live.size')">
          <SegmentedControl :model-value="panelLook.size" :label="t('live.size')" :options="SIZE_OPTIONS.map((option) => ({ ...option, testid: `panel-${option.testid}` }))" :class="fill" @update:model-value="setPanel('size', $event)" />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>

    <SettingsPage v-else :title="t(`live.cat.${page}`)" :description="t('live.intro')">
      <template #preview>
        <SettingsPreview :label="t('live.preview')">
          <div class="h-full w-full overflow-hidden">
            <ul ref="plate" class="live-plate max-w-80" hidden data-testid="live-preview" />
            <p v-if="!state.rows.length" class="text-sm text-white/80">{{ t("live.previewEmpty") }}</p>
          </div>
        </SettingsPreview>
      </template>

      <SettingsSection v-if="page === 'text'">
        <SettingsRow :label="t('live.font')">
          <Select :model-value="look.font" @update:model-value="set('font', $event as LiveLook['font'])">
            <SelectTrigger class="w-full" :aria-label="t('live.font')" data-testid="live-font"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="font in LIVE_FONTS" :key="font.id" :value="font.id" :style="{ fontFamily: font.stack }">{{ font.name }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow :label="t('live.size')">
          <SegmentedControl :model-value="look.size" :label="t('live.size')" :options="SIZE_OPTIONS.map((option) => ({ ...option, testid: `live-${option.testid}` }))" :class="fill" @update:model-value="set('size', $event)" />
          <Toggle :model-value="look.bold" :label="t('live.bold')" class="font-bold" data-testid="live-bold" @update:model-value="set('bold', $event)">B</Toggle>
        </SettingsRow>
        <SettingsRow :label="t('live.color')">
          <ColorPicker :model-value="look.color" :colors="LIVE_COLORS" :labels="colorLabels" :label="t('live.color')" :columns="7" allow-custom data-testid="live-color" @update:model-value="set('color', $event)" />
        </SettingsRow>
        <SettingsRow :label="t('live.outline')" :hint="t('live.outlineHint')">
          <Switch :model-value="look.outline" :aria-label="t('live.outline')" data-testid="live-outline" @update:model-value="set('outline', $event)" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection v-else-if="page === 'background'">
        <SettingsRow :label="t('live.backgroundColor')">
          <ColorPicker
            :model-value="look.backgroundColor"
            :colors="LIVE_COLORS"
            :labels="colorLabels"
            :label="t('live.backgroundColor')"
            :columns="7"
            allow-custom
            data-testid="live-background-color"
            @update:model-value="set('backgroundColor', $event)"
          />
        </SettingsRow>
        <SettingsRow :label="t('live.background')">
          <SliderField :model-value="look.background" :min="LIVE_RANGE.background[0]" :max="LIVE_RANGE.background[1]" :step="5" unit="%" :label="t('live.background')" data-testid="live-background" @update:model-value="set('background', $event)" />
        </SettingsRow>
        <SettingsRow :label="t('live.padding')">
          <SliderField :model-value="look.padding" :min="LIVE_RANGE.padding[0]" :max="LIVE_RANGE.padding[1]" unit="px" :label="t('live.padding')" data-testid="live-padding" @update:model-value="set('padding', $event)" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection v-else>
        <SettingsRow :label="t('live.headers')">
          <Select :model-value="look.headers" @update:model-value="set('headers', $event as LiveHeaders)">
            <SelectTrigger class="w-full" :aria-label="t('live.headers')" data-testid="live-headers"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="value in LIVE_HEADERS" :key="value" :value="value" :data-testid="`live-headers-${value}`">{{ t(`live.headers.${value}`) }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow :label="t('live.finished')">
          <SegmentedControl
            :model-value="look.showFinished ? 'show' : 'hide'"
            :label="t('live.finished')"
            :options="[
              { value: 'hide', label: t('live.finished.hide'), testid: 'live-finished-hide' },
              { value: 'show', label: t('live.finished.show'), testid: 'live-finished-show' },
            ]"
            :class="fill"
            @update:model-value="set('showFinished', $event === 'show')"
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  </ModuleSettings>
</template>
