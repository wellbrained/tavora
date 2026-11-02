<script setup lang="ts">
import { Puzzle } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Skeleton, placeholderText } from "@tavora/official-ui/components/ui/skeleton";
import { computed, onBeforeUnmount, ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
// The real card with made-up text while it "loads": muted bars of the same boxes.
const cardLoading = ref(false);
const card = computed(() =>
  cardLoading.value
    ? { name: placeholderText(14), by: placeholderText(10), text: placeholderText(120) }
    : { name: "Satisfactory Planner", by: "by Wellbrained", text: "Plan factories, belts and power for your next run, and see what each build needs before you place it." },
);
let cardTimer: ReturnType<typeof setTimeout> | undefined;
function loadCard(ms: number) {
  clearTimeout(cardTimer);
  cardLoading.value = true;
  cardTimer = setTimeout(() => (cardLoading.value = false), ms);
}
onBeforeUnmount(() => clearTimeout(cardTimer));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex gap-2">
      <Button size="xs" variant="secondary" :disabled="off" @click="loadCard(1800)">Load slowly</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="loadCard(60)">Load fast (no placeholder)</Button>
    </div>
    <Skeleton :loading="cardLoading" class="flex max-w-sm flex-col gap-3 rounded-xl border p-4" data-testid="skeleton-card">
      <div class="flex min-w-0 gap-3">
        <span class="bg-muted/60 grid size-12 flex-none place-items-center rounded-xl"><Puzzle class="text-muted-foreground size-6" :stroke-width="1.5" /></span>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ card.name }}</p>
          <p class="text-muted-foreground truncate text-xs">{{ card.by }}</p>
          <p class="text-muted-foreground mt-1.5 line-clamp-2 text-sm">{{ card.text }}</p>
        </div>
      </div>
      <div class="flex justify-end"><Button size="sm">Install</Button></div>
    </Skeleton>
  </div>
</template>
