<script setup lang="ts">
// Options with a `group` sit under its heading. The `current` slot fills the button (sized by its class then), `option`
// adds badges at the end of a row, and `filters` holds toggles above the list that narrow the options passed in.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { computed, reactive, ref } from "vue";

const BUILDS = [
  { value: "tower", label: "Tower wall", group: "King of Stone", tags: ["endless", "wip"] },
  { value: "towers", label: "Double towers", group: "King of Stone", tags: ["endless"] },
  { value: "gold", label: "Gold town", group: "King of Greed", tags: ["endless", "farm"] },
  { value: "rush", label: "Early rush", group: "King of Greed", tags: ["beginner"] },
];
const TAGS = ["endless", "beginner", "farm", "wip"];

const build = ref("tower");
const on = reactive<Record<string, boolean>>({});
const options = computed(() =>
  BUILDS.filter((option) => TAGS.every((tag) => !on[tag] || option.tags.includes(tag))).map((option) => ({ ...option, keywords: option.tags.join(" ") })),
);
const current = computed(() => BUILDS.find((option) => option.value === build.value));
</script>

<template>
  <Picker v-model="build" label="Build" search="Search builds" empty="No build found" :options="options" class="w-full max-w-80">
    <template #current>
      <span class="truncate font-medium">{{ current?.label }}</span>
      <span class="text-muted-foreground flex-none text-xs">{{ current?.group }}</span>
    </template>
    <template #filters>
      <div class="flex flex-wrap gap-1.5">
        <Toggle v-for="tag in TAGS" :key="tag" v-model="on[tag]" :label="`Only ${tag}`" class="h-7 w-auto rounded-full px-2.5 text-xs">{{ tag }}</Toggle>
      </div>
    </template>
    <template #option="{ option }">
      <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
      <Badge v-for="tag in BUILDS.find((item) => item.value === option.value)?.tags" :key="tag" variant="outline" class="flex-none">{{ tag }}</Badge>
    </template>
  </Picker>
</template>
