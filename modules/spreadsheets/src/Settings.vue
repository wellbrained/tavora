<script setup lang="ts">
// Spreadsheets' settings, shown while the panel is open as a dialog (panel.openDialog): only the live view over the
// game, as the Overlays pages every module has. Look: the plate, the padding and the text size, with a preview of
// the real thing. In game: what the panel shows over the game, and taking the selection for it. Changes apply at once.
import { Paintbrush } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ModuleSettings, SettingsMainBar, SettingsPage, SettingsPreview, SettingsRow, SettingsSection, settingsMenu } from "@tavora/official-ui/components/ui/module-settings";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { SliderField } from "@tavora/official-ui/components/ui/slider";
import { computed, onMounted, ref, watch } from "vue";
import { uiText } from "@tavora/official-ui/components/ui/text";
import { t } from "./i18n";
import { LIVE_DEFAULTS, LIVE_RANGE, LIVE_SIZE_IDS, type LiveLook, type LiveSize, type LiveState } from "./live";
import { drawPlate } from "./plate";

const props = defineProps<{ state: LiveState | null; showing: string | null; savedAt?: number }>();
const look = defineModel<LiveLook>("look", { required: true });
const emit = defineEmits<{ use: []; stop: [] }>();

const page = ref<"look" | "game">("look");
const groups = computed(() =>
  settingsMenu({
    pages: [],
    look: [{ id: "look", label: t("settings.look"), icon: Paintbrush, testid: "settings-page-look" }],
    inGame: { id: "game", on: props.showing !== null, testid: "settings-page-game" },
  }).filter((group) => group.items.length),
);

function reset(id: string): (() => void) | void {
  if (id !== "look") return;
  const before = look.value;
  look.value = { ...LIVE_DEFAULTS };
  return () => (look.value = before);
}

const set = <K extends keyof LiveLook>(key: K, value: LiveLook[K]) => (look.value = { ...look.value, [key]: value });
const sizes = LIVE_SIZE_IDS.map((size) => ({ value: size, label: size.toUpperCase(), testid: `size-${size}` }));
/** Segments that share the control column evenly. */
const fill = "w-full min-w-0 [&>*]:flex-1 [&>*]:px-0";

const plate = ref<HTMLElement | null>(null);
const draw = () => plate.value && drawPlate(plate.value, props.state);
onMounted(() => void document.fonts.ready.then(draw));
watch([() => props.state, plate], draw, { deep: true });
</script>

<template>
  <ModuleSettings v-model:page="page" :groups="groups" :label="t('settings')" :reset="reset" :resettable="(id) => id === 'look'" :saved-at="savedAt" data-testid="settings">
    <SettingsPage v-if="page === 'look'" :title="t('settings.look')" :description="t('settings.look.text')">
      <template #preview>
        <SettingsPreview :label="t('settings.look')">
          <div class="h-full w-full overflow-hidden">
            <div ref="plate" class="live-plate" hidden data-testid="live-preview" />
          </div>
        </SettingsPreview>
      </template>
      <SettingsSection>
        <SettingsRow :label="t('settings.opacity')" :hint="t('settings.opacity.hint')">
          <SliderField :model-value="look.opacity" :min="LIVE_RANGE.opacity[0]" :max="LIVE_RANGE.opacity[1]" :step="5" unit="%" :label="t('settings.opacity')" data-testid="live-opacity" @update:model-value="set('opacity', $event)" />
        </SettingsRow>
        <SettingsRow :label="t('settings.padding')" :hint="t('settings.padding.hint')">
          <SliderField :model-value="look.padding" :min="LIVE_RANGE.padding[0]" :max="LIVE_RANGE.padding[1]" unit="px" :label="t('settings.padding')" data-testid="live-padding" @update:model-value="set('padding', $event)" />
        </SettingsRow>
        <SettingsRow :label="t('settings.size')" :hint="t('settings.size.hint')">
          <SegmentedControl :model-value="look.size" :label="t('settings.size')" :options="sizes" :class="fill" @update:model-value="set('size', $event as LiveSize)" />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>

    <SettingsPage v-else :title="uiText.inGame" :description="t('settings.game.text')">
      <template #main>
        <SettingsMainBar :label="t('settings.game.showing')" :hint="showing ?? t('settings.game.none')">
          <Button v-if="showing" variant="ghost" size="sm" data-testid="live-stop" @click="emit('stop')">{{ t("settings.game.stop") }}</Button>
          <Button variant="secondary" size="sm" data-testid="live-use" @click="emit('use')">{{ t("settings.game.use") }}</Button>
        </SettingsMainBar>
      </template>
    </SettingsPage>
  </ModuleSettings>
</template>
