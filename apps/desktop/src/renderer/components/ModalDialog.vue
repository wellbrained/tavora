<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

defineProps<{ title: string; description?: string; testid?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent
      class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]"
      :data-testid="testid"
      :show-close-button="false"
    >
      <DialogHeader>
        <DialogTitle class="text-lg">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="text-muted-foreground">{{ description }}</DialogDescription>
      </DialogHeader>
      <slot />
    </DialogContent>
  </Dialog>
</template>
