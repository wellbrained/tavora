<script setup lang="ts">
import { Box, Factory } from "@lucide/vue";
import { TextLink } from "@tavora/official-ui/components/ui/text-link";
import { ref } from "vue";

const opened = ref("");
const PARTS = [
  { id: "plate", name: "Iron Plate", amount: 3 },
  { id: "wire", name: "Copper Wire", amount: 8 },
  { id: "frame", name: "Reinforced Modular Frame Assembly Unit", amount: 1 },
];
</script>

<template>
  <div class="flex max-w-[320px] flex-col gap-3 text-sm">
    <p class="text-muted-foreground">
      Made in
      <TextLink class="text-foreground font-semibold" data-testid="text-link-station" @click="opened = 'Constructor'"><template #icon><Factory /></template>Constructor</TextLink>
      · 4 s · makes 2
    </p>
    <ul class="flex flex-col gap-1">
      <li v-for="part in PARTS" :key="part.id" class="flex min-h-8 items-center gap-2.5">
        <TextLink @click="opened = part.name"><template #icon><Box /></template>{{ part.name }}</TextLink>
        <span class="text-muted-foreground ml-auto flex-none text-xs tabular-nums">×{{ part.amount }}</span>
      </li>
      <li class="flex min-h-8 items-center gap-2.5">
        <TextLink disabled disabled-reason="Not in this version of the game."><template #icon><Box /></template>Ficsonium</TextLink>
      </li>
    </ul>
    <p class="text-muted-foreground">
      Iron Plate is also used by the
      <TextLink wrap class="text-foreground" @click="opened = 'Reinforced Iron Plate'">Reinforced Iron Plate and four other recipes</TextLink>.
    </p>
    <p class="text-muted-foreground text-xs" data-testid="text-link-opened">Opened: {{ opened || "nothing yet" }}</p>
  </div>
</template>
