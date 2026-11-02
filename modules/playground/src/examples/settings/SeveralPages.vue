<script setup lang="ts">
// A module with several pages and no overlays (like System Monitor: Show · Drives · Connection). Inside a section every
// row has a description or none does, and units go in the description.
import { Eye, HardDrive, Wifi } from "@lucide/vue";
import { ModuleSettings, SettingsPage, SettingsRow, SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const DEFAULTS = { cpu: true, memory: true, network: false, c: true, d: true, warn: "90", every: "2", offline: true };
const look = ref({ ...DEFAULTS });
const savedAt = ref<number>();
const page = ref("show");
const WARN = ["70", "80", "90", "95"];
const EVERY = ["1", "2", "5", "10"];

const groups = [
  {
    items: [
      { id: "show", label: "Show", icon: Eye },
      { id: "drives", label: "Drives", icon: HardDrive },
      { id: "connection", label: "Connection", icon: Wifi },
    ],
  },
];

type Key = keyof typeof DEFAULTS;
function set<K extends Key>(key: K, value: (typeof DEFAULTS)[K]) {
  look.value = { ...look.value, [key]: value };
  savedAt.value = Date.now();
}
/** Puts back only the keys of the open page, and returns the way to undo it. */
const PAGE_KEYS: Record<string, Key[]> = { show: ["cpu", "memory", "network"], drives: ["c", "d", "warn"], connection: ["every", "offline"] };
function reset(id: string) {
  const before = look.value;
  look.value = { ...look.value, ...Object.fromEntries((PAGE_KEYS[id] ?? []).map((key) => [key, DEFAULTS[key]])) };
  return () => (look.value = before);
}
</script>

<template>
  <!-- 960 × 680 in the app; shorter here. A narrow panel scrolls it sideways. -->
  <div class="overflow-x-auto">
    <div class="bg-card h-[520px] w-[760px] overflow-hidden rounded-xl border">
      <ModuleSettings v-model:page="page" :groups="groups" label="Settings" :reset="reset" :saved-at="savedAt">
        <SettingsPage v-if="page === 'show'" title="Show" description="What the monitor shows.">
          <SettingsSection>
            <SettingsRow label="Processor">
              <Switch :model-value="look.cpu" aria-label="Processor" :disabled="disabled" @update:model-value="set('cpu', $event)" />
            </SettingsRow>
            <SettingsRow label="Memory">
              <Switch :model-value="look.memory" aria-label="Memory" :disabled="disabled" @update:model-value="set('memory', $event)" />
            </SettingsRow>
            <SettingsRow label="Network">
              <Switch :model-value="look.network" aria-label="Network" :disabled="disabled" @update:model-value="set('network', $event)" />
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>

        <SettingsPage v-else-if="page === 'drives'" title="Drives" description="Which drives it keeps an eye on.">
          <SettingsSection title="Watch">
            <SettingsRow label="Drive C:">
              <Switch :model-value="look.c" aria-label="Drive C:" :disabled="disabled" @update:model-value="set('c', $event)" />
            </SettingsRow>
            <SettingsRow label="Drive D:">
              <Switch :model-value="look.d" aria-label="Drive D:" :disabled="disabled" @update:model-value="set('d', $event)" />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="Warnings">
            <SettingsRow label="Warn when a drive is" hint="In percent full.">
              <Select :model-value="look.warn" :disabled="disabled" @update:model-value="set('warn', $event as string)">
                <SelectTrigger class="w-full" aria-label="Warn when a drive is"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="value in WARN" :key="value" :value="value">{{ value }}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>

        <SettingsPage v-else title="Connection" description="How it gets its numbers.">
          <SettingsSection>
            <SettingsRow label="Update every" hint="In seconds.">
              <Select :model-value="look.every" :disabled="disabled" @update:model-value="set('every', $event as string)">
                <SelectTrigger class="w-full" aria-label="Update every"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="value in EVERY" :key="value" :value="value">{{ value }}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="Keep going offline" hint="Shows the last numbers until you're back online.">
              <Switch :model-value="look.offline" aria-label="Keep going offline" :disabled="disabled" @update:model-value="set('offline', $event)" />
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>
      </ModuleSettings>
    </div>
  </div>
</template>
