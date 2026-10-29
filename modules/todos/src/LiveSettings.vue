<script setup lang="ts">
// How the live view looks, shown while the panel is open as a dialog (panel.openDialog): categories on the left,
// one column on the right with a preview of the real plate over a game-like backdrop. Every change applies at once.
import { LayoutList, Paintbrush, Type } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { NavList } from "@tavora/official-ui/components/ui/nav-list";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed, onMounted, ref, watch } from "vue";
import { t } from "./i18n";
import { LIVE_COLORS, LIVE_DEFAULTS, LIVE_FONTS, LIVE_HEADERS, LIVE_RANGE, LIVE_SIZES, type LiveLook, type LiveSize, type LiveState } from "./live";
import { drawPlate } from "./plate";

const props = defineProps<{ state: LiveState }>();
const look = defineModel<LiveLook>("look", { required: true });

type Category = "text" | "background" | "content";
const category = ref<Category>("text");
const categories = computed(() => [
  {
    items: [
      { id: "text", label: t("live.cat.text"), icon: Type, testid: "live-cat-text" },
      { id: "background", label: t("live.cat.background"), icon: Paintbrush, testid: "live-cat-background" },
      { id: "content", label: t("live.cat.content"), icon: LayoutList, testid: "live-cat-content" },
    ],
  },
]);

const COLOR_NAMES = ["white", "yellow", "orange", "red", "pink", "violet", "blue", "teal", "green", "black"];
const colorLabels = computed(() => COLOR_NAMES.map((name) => t(`color.${name}` as "color.red")));

function set<K extends keyof LiveLook>(key: K, value: LiveLook[K] | undefined) {
  if (value !== undefined) look.value = { ...look.value, [key]: value };
}

const plate = ref<HTMLElement | null>(null);
const draw = () => plate.value && drawPlate(plate.value, props.state);
onMounted(() => {
  draw();
  void document.fonts.ready.then(draw);
});
watch(() => props.state, draw, { deep: true });
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="live-settings-dialog">
    <NavList v-model="category" :groups="categories" :label="t('live.menu')" class="w-44 flex-none border-r p-2" />
    <div class="min-w-0 flex-1 overflow-y-auto p-4">
      <h2 class="text-base font-semibold">{{ t("live.menu") }}</h2>
      <p class="text-muted-foreground mt-0.5 text-sm">{{ t("live.intro") }}</p>

      <!-- The real plate over a backdrop with bright and dark parts, so you can see how readable it is. -->
      <div class="live-backdrop mt-3 h-44 overflow-hidden rounded-lg p-3" :aria-label="t('live.preview')" role="img">
        <ul ref="plate" class="live-plate max-w-80" hidden data-testid="live-preview" />
        <p v-if="!state.rows.length" class="text-sm text-white/80">{{ t("live.previewEmpty") }}</p>
      </div>

      <div class="mt-4 flex flex-col gap-4">
        <template v-if="category === 'text'">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ t("live.font") }}</span>
            <Select :model-value="look.font" @update:model-value="set('font', $event as LiveLook['font'])">
              <SelectTrigger class="w-52" :aria-label="t('live.font')" data-testid="live-font"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="font in LIVE_FONTS" :key="font.id" :value="font.id" :style="{ fontFamily: font.stack }">{{ font.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ t("live.size") }}</span>
            <Select :model-value="look.size" @update:model-value="set('size', $event as LiveSize)">
              <SelectTrigger class="w-52" :aria-label="t('live.size')" data-testid="live-size"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="size in Object.keys(LIVE_SIZES) as LiveSize[]" :key="size" :value="size">{{ t(`live.size.${size}`) }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label class="flex items-center justify-between gap-3 text-sm">
            {{ t("live.bold") }}
            <Switch :model-value="look.bold" data-testid="live-bold" @update:model-value="set('bold', $event)" />
          </label>
          <div class="flex flex-col gap-2">
            <span class="text-sm">{{ t("live.color") }}</span>
            <ColorPicker :model-value="look.color" :colors="LIVE_COLORS" :labels="colorLabels" :label="t('live.color')" allow-custom data-testid="live-color" @update:model-value="set('color', $event)" />
          </div>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              {{ t("live.outline") }}
              <span class="text-muted-foreground block text-xs">{{ t("live.outlineHint") }}</span>
            </span>
            <Switch :model-value="look.outline" data-testid="live-outline" @update:model-value="set('outline', $event)" />
          </label>
        </template>

        <template v-else-if="category === 'background'">
          <div class="flex flex-col gap-2">
            <span class="text-sm">{{ t("live.backgroundColor") }}</span>
            <ColorPicker
              :model-value="look.backgroundColor"
              :colors="LIVE_COLORS"
              :labels="colorLabels"
              :label="t('live.backgroundColor')"
              allow-custom
              data-testid="live-background-color"
              @update:model-value="set('backgroundColor', $event)"
            />
          </div>
          <div>
            <div class="flex items-center justify-between text-sm">
              <span>{{ t("live.background") }}</span>
              <span class="text-muted-foreground tabular-nums" data-testid="live-background-value">{{ look.background }}%</span>
            </div>
            <Slider
              :model-value="[look.background]"
              :min="LIVE_RANGE.background[0]"
              :max="LIVE_RANGE.background[1]"
              :step="1"
              class="mt-2"
              :aria-label="t('live.background')"
              data-testid="live-background"
              @update:model-value="set('background', $event?.[0])"
            />
          </div>
          <div>
            <div class="flex items-center justify-between text-sm">
              <span>{{ t("live.padding") }}</span>
              <span class="text-muted-foreground tabular-nums" data-testid="live-padding-value">{{ look.padding }} px</span>
            </div>
            <Slider
              :model-value="[look.padding]"
              :min="LIVE_RANGE.padding[0]"
              :max="LIVE_RANGE.padding[1]"
              :step="1"
              class="mt-2"
              :aria-label="t('live.padding')"
              data-testid="live-padding"
              @update:model-value="set('padding', $event?.[0])"
            />
          </div>
        </template>

        <template v-else>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ t("live.headers") }}</span>
            <SegmentedControl
              :model-value="look.headers"
              :label="t('live.headers')"
              :options="LIVE_HEADERS.map((value) => ({ value, label: t(`live.headers.${value}`), testid: `live-headers-${value}` }))"
              @update:model-value="set('headers', $event)"
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ t("live.finished") }}</span>
            <SegmentedControl
              :model-value="look.showFinished ? 'show' : 'hide'"
              :label="t('live.finished')"
              :options="[
                { value: 'hide', label: t('live.finished.hide'), testid: 'live-finished-hide' },
                { value: 'show', label: t('live.finished.show'), testid: 'live-finished-show' },
              ]"
              @update:model-value="set('showFinished', $event === 'show')"
            />
          </div>
        </template>

        <div>
          <Button variant="ghost" size="sm" data-testid="live-reset" @click="look = { ...LIVE_DEFAULTS }">{{ t("live.reset") }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.live-backdrop {
  background:
    radial-gradient(circle at 80% 20%, #f3e3b0 0, transparent 45%),
    linear-gradient(135deg, #24321f 0%, #5d7046 35%, #b9a777 65%, #43566a 100%);
}
</style>
