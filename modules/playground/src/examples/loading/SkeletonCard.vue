<script setup lang="ts">
// The real card with made-up text while it "loads": every box inside turns into a muted bar of its own size.
import { Puzzle } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Skeleton, placeholderText } from "@tavora/official-ui/components/ui/skeleton";
import { computed, onBeforeUnmount, ref } from "vue";

defineProps<{ disabled?: boolean }>();

const loading = ref(false);
const card = computed(() =>
  loading.value
    ? { name: placeholderText(14), by: placeholderText(10), text: placeholderText(120) }
    : { name: "Satisfactory Planner", by: "by Wellbrained", text: "Plan factories, belts and power for your next run, and see what each build needs before you place it." },
);
let timer: ReturnType<typeof setTimeout> | undefined;
function load(ms: number) {
  clearTimeout(timer);
  loading.value = true;
  timer = setTimeout(() => (loading.value = false), ms);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" :disabled="disabled" @click="load(1800)">Load slowly</Button>
      <Button size="xs" variant="secondary" :disabled="disabled" @click="load(60)">Load fast (no placeholder)</Button>
    </div>
    <Skeleton :loading="loading" class="flex max-w-sm flex-col gap-3 rounded-xl border p-4" data-testid="skeleton-card">
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
