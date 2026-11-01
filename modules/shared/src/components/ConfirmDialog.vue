<script setup lang="ts">
// Asks before something happens. An optional icon, the title and one sentence, buttons bottom right with the action
// last, as the style guide asks for dialogs. The icon in front of the title follows the tone (pass `icon` for a more
// fitting one, `false` for none). Cancel never has an icon; the action may (`confirmIcon`). The action is red by default (`tone="destructive"`);
// `tone="default"` makes it a plain confirm. `busy` locks the dialog while the action runs.
// Without `open` the dialog is open as long as it is rendered (`v-if`); with `v-model:open` the caller controls it.
import { CircleHelp, TriangleAlert } from "@lucide/vue";
import { computed, type Component } from "vue";
import { uiText } from "./ui/text";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "./ui/dialog";

const props = withDefaults(defineProps<{ title: string; description: string; confirm: string; cancel?: string; tone?: "destructive" | "default"; busy?: boolean; open?: boolean; icon?: Component | false; confirmIcon?: Component }>(), { tone: "destructive", open: true, icon: undefined }); // `icon` lists `false`, which Vue would otherwise make the default
// The icon in front of the title follows the tone unless the caller gives one (`false` for none).
const headerIcon = computed(() => (props.icon === false ? undefined : (props.icon ?? (props.tone === "destructive" ? TriangleAlert : CircleHelp))));
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
      class="top-[12vh] translate-y-0 sm:max-w-[420px]"
      data-testid="confirm"
      @escape-key-down="(e: Event) => busy && e.preventDefault()"
      @interact-outside="(e: Event) => busy && e.preventDefault()"
    >
      <DialogHeader :icon="headerIcon" :title="title" :description="description" />
      <DialogFooter>
        <DialogButton close autofocus :disabled="busy" data-testid="confirm-cancel" @click="cancel">{{ props.cancel ?? uiText.cancel }}</DialogButton>
        <DialogButton :variant="tone === 'destructive' ? 'destructive' : 'default'" :icon="confirmIcon" :loading="busy" :disabled="busy" :aria-busy="busy || undefined" data-testid="confirm-submit" @click="emit('confirm')">
          {{ confirm }}
        </DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
