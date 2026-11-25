<script setup lang="ts">
import { CloudRain, Sun, Volume2 } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { ListRow } from "@tavora/official-ui/components/ui/list-row";
import { ref } from "vue";

const PLACES = [
  { id: "berlin", name: "Berlin", sky: "Light rain · 40% later", temp: "12°", rain: true },
  { id: "lisbon", name: "Lisbon", sky: "Sunny all day", temp: "21°", rain: false },
  { id: "reykjavik", name: "Reykjavíkurborg and the capital region", sky: "Clouds, dry", temp: "4°", rain: false },
];
const selected = ref("berlin");
</script>

<template>
  <div class="flex max-w-[320px] flex-col gap-4">
    <ul class="flex flex-col gap-0.5" aria-label="Places">
      <li v-for="place in PLACES" :key="place.id">
        <ListRow :selected="selected === place.id" :data-testid="`list-row-${place.id}`" @click="selected = place.id">
          <template #leading><CloudRain v-if="place.rain" /><Sun v-else /></template>
          {{ place.name }}
          <template #description>{{ place.sky }}</template>
          <template #trailing><span class="tabular-nums">{{ place.temp }}</span></template>
        </ListRow>
      </li>
      <li>
        <ListRow disabled disabled-reason="You've already added this one.">
          <template #leading><Sun /></template>
          Madrid
          <template #trailing>Added</template>
        </ListRow>
      </li>
    </ul>
    <ul class="flex flex-col gap-0.5" aria-label="Voice channels">
      <li>
        <ListRow as="div" selected class="font-medium">
          <template #leading><Volume2 /></template>
          General
          <template #trailing><Badge variant="secondary">You're here</Badge></template>
        </ListRow>
      </li>
      <li>
        <ListRow><template #leading><Volume2 /></template>Raid night</ListRow>
      </li>
    </ul>
  </div>
</template>
