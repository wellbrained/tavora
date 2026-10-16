<script setup lang="ts">
// A picture shown as large as the panel allows. Any click, or Escape, closes it.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onBeforeUnmount, onMounted } from "vue";
import { t } from "./i18n";

defineProps<{ src: string }>();
const emit = defineEmits<{ close: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  emit("close");
}

onMounted(() => addEventListener("keydown", onKey, true));
onBeforeUnmount(() => removeEventListener("keydown", onKey, true));
</script>

<template>
  <div class="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" :aria-label="t('image.larger')" data-testid="image-lightbox" @click="emit('close')">
    <img :src="src" alt="" class="max-h-full max-w-full object-contain" draggable="false" />
    <Button variant="secondary" size="icon-sm" class="absolute top-3 right-3" :aria-label="t('image.close')" :title="t('image.close')" @click.stop="emit('close')">
      <X :stroke-width="1.5" />
    </Button>
  </div>
</template>
