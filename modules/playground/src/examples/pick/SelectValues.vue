<script setup lang="ts">
import { Gamepad2, Globe, Monitor } from "@lucide/vue";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { computed, ref } from "vue";

const PLACES = [
  { value: "game", label: "In game", description: "Shows over the game.", icon: Gamepad2 },
  { value: "desktop", label: "Desktop", description: "Shows on your desktop.", icon: Monitor },
  { value: "web", label: "Browser", description: "Opens as a web page.", icon: Globe },
];
const place = ref("game");
const detailed = ref("game");
const picked = ref("game");
const iconOf = (value: string) => PLACES.find((item) => item.value === value)!.icon;
const current = computed(() => PLACES.find((item) => item.value === detailed.value)!);
</script>

<template>
  <div class="flex flex-wrap items-start gap-3">
    <Select v-model="place">
      <SelectTrigger class="w-48" aria-label="Show">
        <template #value><component :is="iconOf(place)" /><SelectValue /></template>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="item in PLACES" :key="item.value" :value="item.value"><template #thumb><component :is="item.icon" /></template>{{ item.label }}</SelectItem>
      </SelectContent>
    </Select>
    <Select v-model="detailed">
      <SelectTrigger size="auto" class="w-64" aria-label="Show" data-testid="select-value-auto">
        <template #value>
          <component :is="current.icon" class="ml-1 size-5!" />
          <span class="flex min-w-0 flex-col">
            <span class="truncate font-medium">{{ current.label }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ current.description }}</span>
          </span>
        </template>
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="item in PLACES" :key="item.value" :value="item.value" :description="item.description"><template #thumb><component :is="item.icon" /></template>{{ item.label }}</SelectItem>
      </SelectContent>
    </Select>
    <Picker v-model="picked" :options="PLACES" label="Show">
      <template #value="{ option }"><component :is="iconOf(option.value)" class="size-4" /><span class="truncate">{{ option.label }}</span></template>
    </Picker>
  </div>
</template>
