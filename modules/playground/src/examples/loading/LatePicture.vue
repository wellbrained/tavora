<script setup lang="ts">
import { Puzzle } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { FadeImage } from "@tavora/official-ui/components/ui/fade-image";
import { onBeforeUnmount, ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
// A picture that arrives late, one that never does.
const PICTURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGPIq+iZtmALhGSAs4AkA04ZALkyGuGrUrMPAAAAAElFTkSuQmCC";
const latePicture = ref<string | null>(null);
let pictureTimer: ReturnType<typeof setTimeout> | undefined;
function loadPicture() {
  clearTimeout(pictureTimer);
  latePicture.value = null;
  pictureTimer = setTimeout(() => (latePicture.value = `${PICTURE}#${Date.now()}`), 900);
}
loadPicture();
onBeforeUnmount(() => clearTimeout(pictureTimer));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <FadeImage :src="latePicture" :pending="latePicture === null" class="size-16 rounded-xl" alt="" data-testid="fade-late"><template #fallback><Puzzle class="text-muted-foreground size-6" :stroke-width="1.5" /></template></FadeImage>
    <FadeImage src="missing.png" class="size-16 rounded-xl" alt="" data-testid="fade-failed"><template #fallback><Puzzle class="text-muted-foreground size-6" :stroke-width="1.5" /></template></FadeImage>
    <Button size="xs" variant="secondary" :disabled="off" @click="loadPicture">Load again</Button>
  </div>
</template>
