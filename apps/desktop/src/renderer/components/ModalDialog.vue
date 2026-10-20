<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";

defineProps<{ title: string; description?: string; testid?: string; class?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent
      :class="cn('top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]', $props.class)"
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
