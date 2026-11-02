<script setup lang="ts">
// A module with only one page of settings: no menu, the rows straight on the dialog, and a narrower dialog that asks for
// its size with settingsDialogSize (here five rows, so it keeps the height of six).
import { PanelsTopLeft } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { ModuleSettings, SettingsPage, SettingsRow, SettingsSection, settingsDialogSize } from "@tavora/official-ui/components/ui/module-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed, ref } from "vue";

defineProps<{ disabled?: boolean }>();

const DEFAULTS = { seconds: true, twentyFour: true, size: "m", color: "#ffffff", every: "15" };
const look = ref({ ...DEFAULTS });
const savedAt = ref<number>();
const page = ref("clock");
const COLORS = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#f472b6", "#a78bfa", "#60a5fa", "#2dd4bf", "#4ade80", "#000000"];
const SIZES = ["s", "m", "l"].map((value) => ({ value, label: value.toUpperCase() }));
const EVERY = ["5", "10", "15", "30", "60"];

// One page, so the dialog asks for the narrow size. In a module: tavora.panel.openDialog(size).
const size = settingsDialogSize({ pages: 1, rows: 5 });
const groups = computed(() => [{ items: [{ id: "clock", label: "Clock", icon: PanelsTopLeft }] }]);

function set<K extends keyof typeof DEFAULTS>(key: K, value: (typeof DEFAULTS)[K]) {
  look.value = { ...look.value, [key]: value };
  savedAt.value = Date.now();
}
function reset() {
  const before = look.value;
  look.value = { ...DEFAULTS };
  return () => (look.value = before);
}
</script>

<template>
  <!-- The size the dialog asks for (760 wide); a narrow panel scrolls it sideways. -->
  <div class="overflow-x-auto">
    <div class="bg-card overflow-hidden rounded-xl border" :style="{ width: `${size.width}px`, height: `${size.height}px` }">
      <ModuleSettings v-model:page="page" :groups="groups" label="Settings" :reset="reset" :saved-at="savedAt">
        <SettingsPage title="Clock" description="How the clock looks over your game.">
          <SettingsSection>
            <SettingsRow label="Show seconds" hint="Ticks along with the clock.">
              <Switch :model-value="look.seconds" aria-label="Show seconds" :disabled="disabled" @update:model-value="set('seconds', $event)" />
            </SettingsRow>
            <SettingsRow label="24-hour clock" hint="Instead of AM and PM.">
              <Switch :model-value="look.twentyFour" aria-label="24-hour clock" :disabled="disabled" @update:model-value="set('twentyFour', $event)" />
            </SettingsRow>
            <SettingsRow label="Text size" hint="Bigger is easier to read from afar.">
              <SegmentedControl :model-value="look.size" label="Text size" :options="SIZES" class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0" :disabled="disabled" @update:model-value="set('size', $event)" />
            </SettingsRow>
            <SettingsRow label="Text colour" hint="Pick one that stands out.">
              <ColorPicker :model-value="look.color" :colors="COLORS" label="Text colour" :columns="7" allow-custom :disabled="disabled" @update:model-value="set('color', $event)" />
            </SettingsRow>
            <SettingsRow label="Remind me every" hint="In minutes.">
              <Select :model-value="look.every" :disabled="disabled" @update:model-value="set('every', $event as string)">
                <SelectTrigger class="w-full" aria-label="Remind me every"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="value in EVERY" :key="value" :value="value">{{ value }}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>
      </ModuleSettings>
    </div>
  </div>
</template>
