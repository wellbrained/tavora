<script setup lang="ts">
// A picture that arrives late, one that never does: the box is there first, so nothing moves.
import { Puzzle } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { FadeImage } from "@tavora/official-ui/components/ui/fade-image";
import { onBeforeUnmount, ref } from "vue";

const PICTURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGPIq+iZtmALhGSAs4AkA04ZALkyGuGrUrMPAAAAAElFTkSuQmCC";
const late = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
function load() {
  clearTimeout(timer);
  late.value = null;
  timer = setTimeout(() => (late.value = `${PICTURE}#${Date.now()}`), 900);
}
load();
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <FadeImage :src="late" :pending="late === null" class="size-16 rounded-xl" alt="" data-testid="fade-late"><template #fallback><Puzzle class="text-muted-foreground size-6" :stroke-width="1.5" /></template></FadeImage>
    <FadeImage src="missing.png" class="size-16 rounded-xl" alt="" data-testid="fade-failed"><template #fallback><Puzzle class="text-muted-foreground size-6" :stroke-width="1.5" /></template></FadeImage>
    <Button size="xs" variant="secondary" @click="load">Load again</Button>
  </div>
</template>
