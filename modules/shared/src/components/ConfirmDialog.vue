<script setup lang="ts">
// Asks before something is deleted. Title plus one sentence, buttons bottom
// right with the action last, as the style guide asks for dialogs.
import { Button } from "./ui/button";
import { uiText } from "./ui/text";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

defineProps<{ title: string; description: string; confirm: string; cancel?: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]" data-testid="confirm" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" autofocus @click="emit('cancel')">{{ cancel ?? uiText.cancel }}</Button>
        <Button type="button" variant="destructive" data-testid="confirm-submit" @click="emit('confirm')">{{ confirm }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
