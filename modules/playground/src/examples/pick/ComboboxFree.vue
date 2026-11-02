<script setup lang="ts">
import { Combobox, ComboboxAnchor, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@tavora/official-ui/components/ui/combobox";
import { ref } from "vue";

// The text is the value; the list only suggests. `ignore-filter` keeps every suggestion in view while typing. Pressing the picked suggestion
// again sends nothing (the list toggles), so the text stays.
const FORMATS = [
  { format: "s", example: "14709" },
  { format: "m:ss", example: "245:09" },
  { format: "mm:ss", example: "245:09" },
  { format: "h:mm:ss", example: "4:05:09" },
  { format: "hh:mm:ss", example: "04:05:09" },
];
const text = ref("m:ss");
const open = ref(false);
function commit(value: string) {
  text.value = value;
  open.value = false;
}
</script>

<template>
  <Combobox v-model:open="open" :model-value="text" ignore-filter :reset-search-term-on-blur="false" :reset-search-term-on-select="false" @update:model-value="(value) => (typeof value === 'string' ? commit(value) : (open = false))">
    <ComboboxAnchor class="w-56">
      <ComboboxInput v-model="text" free :icon="false" :clearable="false" class="font-mono" aria-label="Format" @commit="commit" />
      <ComboboxTrigger label="Show formats" />
    </ComboboxAnchor>
    <ComboboxList>
      <ComboboxItem v-for="{ format, example } in FORMATS" :key="format" :value="format" class="tabular-nums">{{ format }} · {{ example }}</ComboboxItem>
    </ComboboxList>
  </Combobox>
</template>
