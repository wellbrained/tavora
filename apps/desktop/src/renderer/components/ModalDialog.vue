<script setup lang="ts">
// The app's standard dialog: an optional icon, a title, one short line, then what goes in the slot: the content (one
// element, so the gap to the header and to the footer stays the same) and a DialogFooter last, with DialogButton
// buttons (an action may have an icon, a Cancel/Close/Done button never does). In a form, make the form `contents`
// so the footer's Save button still submits it.
import type { Component } from "vue";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader } from "@tavora/official-ui/components/ui/dialog";

defineProps<{ title: string; description?: string; icon?: Component; testid?: string; class?: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent :class="cn('top-[12vh] max-h-[calc(88vh-1rem)] translate-y-0 overflow-y-auto sm:max-w-[420px]', $props.class)" :data-testid="testid">
      <DialogHeader :icon="icon" :title="title" :description="description" />
      <div class="flex flex-col gap-4 [&_[data-slot=dialog-footer]]:mt-2"><slot /></div>
    </DialogContent>
  </Dialog>
</template>
