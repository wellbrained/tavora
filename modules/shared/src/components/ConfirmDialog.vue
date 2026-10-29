<script setup lang="ts">
// Asks before something happens. Title plus one sentence, buttons bottom right with the action
// last, as the style guide asks for dialogs. The action is red by default (`tone="destructive"`);
// `tone="default"` makes it a plain confirm. `busy` locks the dialog while the action runs.
// Without `open` the dialog is open as long as it is rendered (`v-if`); with `v-model:open` the caller controls it.
import { Loader2 } from "@lucide/vue";
import { Button } from "./ui/button";
import { uiText } from "./ui/text";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const props = withDefaults(defineProps<{ title: string; description: string; confirm: string; cancel?: string; tone?: "destructive" | "default"; busy?: boolean; open?: boolean }>(), { tone: "destructive", open: true });
const emit = defineEmits<{ confirm: []; cancel: []; "update:open": [open: boolean] }>();

function cancel() {
  if (props.busy) return;
  emit("update:open", false);
  emit("cancel");
}
</script>

<template>
  <Dialog :open="open" @update:open="(value: boolean) => !value && cancel()">
    <DialogContent
      class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]"
      data-testid="confirm"
      :show-close-button="false"
      @escape-key-down="(e: Event) => busy && e.preventDefault()"
      @interact-outside="(e: Event) => busy && e.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle class="text-lg">{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" autofocus :disabled="busy" data-testid="confirm-cancel" @click="cancel">{{ props.cancel ?? uiText.cancel }}</Button>
        <Button type="button" :variant="tone === 'destructive' ? 'destructive' : 'default'" :disabled="busy" :aria-busy="busy || undefined" data-testid="confirm-submit" @click="emit('confirm')">
          <Loader2 v-if="busy" class="animate-spin" :stroke-width="1.5" aria-hidden="true" />
          {{ confirm }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
