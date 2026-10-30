<script setup lang="ts">
// Asks for a name: a title, one labelled field, the limit shown as a count. The text starts as `value`
// and is selected, so typing replaces it; Enter confirms. Extra fields go in the default slot, below the name.
// Without `open` the dialog is open as long as it is rendered (`v-if`); with `v-model:open` the caller controls it.
// `value` may change while the dialog is open (a name filled in from a picked file): the field follows it until
// the user types; after that their text wins and later changes are ignored (until the dialog opens again).
// `ready` (default true) turns Save off while the caller is not done, e.g. before a file is picked.
import { computed, ref, watch } from "vue";
import { Loader2 } from "@lucide/vue";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { uiText } from "./ui/text";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { checkName, DEFAULT_NAME_LIMIT, followValue } from "./name-check";

const props = withDefaults(
  defineProps<{ title: string; label: string; confirm: string; description?: string; value?: string; placeholder?: string; maxLength?: number; cancel?: string; busy?: boolean; error?: string; open?: boolean; ready?: boolean }>(),
  { value: "", maxLength: DEFAULT_NAME_LIMIT, open: true, ready: true },
);
const emit = defineEmits<{ submit: [name: string]; cancel: []; "update:open": [open: boolean] }>();

const text = ref(props.value);
const touched = ref(false);
const typed = ref(false);
const form = ref<HTMLElement | null>(null);
const id = `name-dialog-${Math.random().toString(36).slice(2, 8)}`;

watch(() => props.open, (open) => {
  if (!open) return;
  text.value = props.value;
  touched.value = false;
  typed.value = false;
});
watch(() => props.value, (value) => (text.value = followValue(text.value, typed.value, value)));

const problem = computed(() => checkName(text.value, props.maxLength));
// "Empty" shows only after a try; "too long" as soon as the count goes over.
const message = computed(() => {
  if (problem.value === "tooLong") return uiText.value.nameTooLong.replace("{max}", String(props.maxLength));
  if (problem.value === "empty" && touched.value) return uiText.value.nameEmpty;
  return "";
});

function focusName(event: Event) {
  event.preventDefault();
  const input = form.value?.querySelector("input");
  input?.focus();
  input?.select();
}

function submit() {
  if (props.busy || !props.ready) return;
  touched.value = true;
  if (problem.value) return;
  emit("submit", text.value.trim());
}

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
      data-testid="name-dialog"
      :show-close-button="false"
      @open-auto-focus="focusName"
      @escape-key-down="(e: Event) => busy && e.preventDefault()"
      @interact-outside="(e: Event) => busy && e.preventDefault()"
    >
      <form ref="form" class="flex flex-col gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle class="text-lg">{{ title }}</DialogTitle>
          <DialogDescription v-if="description">{{ description }}</DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <Label :for="id">{{ label }}</Label>
            <span class="text-xs tabular-nums" :class="text.trim().length > maxLength ? 'text-destructive' : 'text-muted-foreground'" data-testid="name-count">{{ text.trim().length }} / {{ maxLength }}</span>
          </div>
          <Input
            :id="id"
            v-model="text"
            :placeholder="placeholder"
            :disabled="busy"
            :aria-invalid="!!message || undefined"
            :aria-describedby="message ? id + '-error' : undefined"
            autocomplete="off"
            data-testid="name-input"
            @update:model-value="touched = false; typed = true"
          />
          <p v-if="message" :id="id + '-error'" class="text-destructive text-xs" role="alert" data-testid="name-error">{{ message }}</p>
        </div>
        <slot />
        <p v-if="error" class="text-destructive text-xs" role="alert" data-testid="name-failed">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="secondary" :disabled="busy" data-testid="name-cancel" @click="cancel">{{ props.cancel ?? uiText.cancel }}</Button>
          <Button type="submit" :disabled="busy || !ready || !!problem" :aria-busy="busy || undefined" data-testid="name-submit">
            <Loader2 v-if="busy" class="animate-spin" :stroke-width="1.5" aria-hidden="true" />
            {{ confirm }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
