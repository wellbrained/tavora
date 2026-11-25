<script setup lang="ts">
// An always-open list with a search on top, for an "Add …" dialog: typing anywhere goes into the field, the arrow keys
// move the lit row and Enter takes it. Rows can have a second line, text at the end, a group, or be off with a reason.
import { Listbox, type ListboxOption } from "@tavora/official-ui/components/ui/listbox";
import { ref } from "vue";

const added = ref(["bergen"]);
const PLACES = [
  { value: "berlin", label: "Berlin", description: "Germany", meta: "±0 h" },
  { value: "bern", label: "Bern", description: "Switzerland", meta: "±0 h", keywords: "schweiz" },
  { value: "bergen", label: "Bergen", description: "Norway", meta: "±0 h", keywords: "norwegen" },
  { value: "boston", label: "Boston", description: "United States", meta: "−6 h", keywords: "usa" },
  { value: "bermuda", label: "Bermuda", description: "Atlantic", meta: "−5 h", group: "Islands" },
  { value: "bali", label: "Bali", description: "Indonesia", meta: "+7 h", group: "Islands" },
];
const options = (): ListboxOption[] => PLACES.map((place) => (added.value.includes(place.value) ? { ...place, disabled: "Already added" } : place));
</script>

<template>
  <div class="flex h-80 w-full max-w-80 flex-col gap-2">
    <Listbox :options="options()" label="Add a clock" search="Search a city or country" empty="No place found" :autofocus="false" class="flex-1" @pick="(place) => added.push(place)" />
    <p class="text-muted-foreground text-xs">Added: {{ added.join(", ") }}</p>
  </div>
</template>
