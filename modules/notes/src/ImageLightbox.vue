<script setup lang="ts">
// A picture shown as large as the panel allows. Any click, or Escape, closes it.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
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
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent
      class="flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/80 p-4 sm:max-w-none"
      data-testid="image-lightbox"
      :show-close-button="false"
      @click="emit('close')"
    >
      <DialogTitle class="sr-only">{{ t("image.larger") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t("image.lightboxHint") }}</DialogDescription>
      <img :src="src" alt="" class="max-h-full max-w-full cursor-zoom-out object-contain" draggable="false" />
      <Button variant="secondary" size="icon-sm" class="absolute top-3 right-3" :aria-label="t('image.close')" :title="t('image.close')" @click.stop="emit('close')">
        <X :stroke-width="1.5" />
      </Button>
    </DialogContent>
  </Dialog>
</template>
