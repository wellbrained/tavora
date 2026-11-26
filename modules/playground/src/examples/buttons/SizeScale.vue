<script setup lang="ts">
import { Bold } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

const SIZES = ["sm", "default", "lg"] as const;
const map = ref("nordic");
const range = ref("week");
const bold = ref(true);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-for="size in SIZES" :key="size" class="flex flex-wrap items-center gap-2">
      <Button :size="size" variant="secondary">Save</Button>
      <Input :size="size" placeholder="Name" class="w-28" />
      <Picker v-model="map" :size="size" label="Map" :options="[{ value: 'nordic', label: 'Nordic' }, { value: 'desert', label: 'Desert' }]" class="min-w-32" />
      <SegmentedControl v-model="range" :size="size" label="Range" :options="[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]" />
      <Toggle v-model="bold" :size="size" label="Bold"><Bold /></Toggle>
    </div>
  </div>
</template>
