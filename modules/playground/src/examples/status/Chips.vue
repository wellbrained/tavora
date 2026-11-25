<script setup lang="ts">
import { Flame, Swords } from "@lucide/vue";
import { Chip } from "@tavora/official-ui/components/ui/chip";
import { ref } from "vue";

// Chips are the user's own words: remove one with its ×, or switch one on and off as a filter. Same corners and tints as Badge.
const tags = ref(["Speedrun", "Co-op", "Boss rush"]);
const kinds = ref<Record<string, boolean>>({ Units: true, Spells: false, Buildings: true, Kings: false });
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Chip v-for="tag in tags" :key="tag" :label="tag" removable @remove="tags = tags.filter((known) => known !== tag)" />
      <Chip label="Outline" variant="outline" removable />
      <Chip label="Saved" variant="success" removable />
      <Chip label="Low" variant="warning" removable />
      <Chip label="Beta" variant="info" removable />
      <Chip label="Failed" variant="destructive" removable />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Chip label="Fire" removable><template #icon><Flame /></template></Chip>
      <Chip label="Melee" variant="outline" removable><template #icon><Swords /></template></Chip>
      <Chip label="Legendary" removable><template #icon><span class="bg-primary size-2 rounded-full" /></template></Chip>
      <Chip label="Rare" removable><template #icon><span class="bg-info size-2 rounded-full" /></template></Chip>
      <Chip label="Off" removable disabled />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Chip label="Small" size="sm" removable />
      <Chip label="Default" removable />
      <Chip label="Large" size="lg" removable />
      <Chip label="Read only" size="lg" />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Chip v-for="(on, kind) in kinds" :key="kind" :label="kind" toggle :selected="on" @update:selected="kinds[kind] = $event" />
    </div>
  </div>
</template>
