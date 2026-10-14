<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";
import { normalizeLink } from "./notes";

const props = defineProps<{ initial: string }>();
const emit = defineEmits<{ apply: [href: string | null]; cancel: [] }>();

const value = ref(props.initial);
const error = ref("");

function submit() {
  if (!value.value.trim()) return emit("apply", null);
  const href = normalizeLink(value.value);
  if (!href) {
    error.value = "Enter a web address such as https://example.com.";
    return;
  }
  emit("apply", href);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('cancel')">
    <DialogContent class="top-[12vh] translate-y-0 gap-4 sm:max-w-[420px]" data-testid="link-dialog" :show-close-button="false">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ initial ? "Edit link" : "Add link" }}</DialogTitle>
        <DialogDescription>Links are saved with the note and shown in gold.</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-2" @submit.prevent="submit">
        <Input
          v-model="value"
          data-testid="link-input"
          placeholder="https://"
          aria-label="Web address"
          :aria-invalid="error ? true : undefined"
          autofocus
          @update:model-value="error = ''"
        />
        <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
        <div class="mt-2 flex justify-end gap-2">
          <Button v-if="initial" type="button" variant="secondary" class="text-destructive mr-auto" @click="emit('apply', null)">
            Remove link
          </Button>
          <Button type="button" variant="secondary" @click="emit('cancel')">Cancel</Button>
          <Button type="submit" data-testid="link-submit">Save link</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
