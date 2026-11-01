<script setup lang="ts">
import { ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Pencil } from "@lucide/vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { dialog, type PromptRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: PromptRequest }>();
const value = ref(props.request.value);
const error = ref<string | null>(null);
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = await props.request.submit(value.value);
  busy.value = false;
  if (!error.value) dialog.value = null;
}
</script>

<template>
  <ModalDialog :title="request.title" :icon="Pencil" testid="prompt" @close="dialog = null">
    <form class="contents" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label for="prompt-input" class="text-muted-foreground font-normal">{{ request.label }}</Label>
        <Input
          id="prompt-input"
          v-model="value"
          data-testid="prompt-input"
          :maxlength="request.maxLength"
          :aria-invalid="error ? true : undefined"
          autofocus
          @focus="($event.target as HTMLInputElement).select()"
        />
        <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="prompt-error">{{ error }}</p>
      </div>
      <DialogFooter>
        <DialogButton type="button" close @click="dialog = null">{{ t("common.cancel") }}</DialogButton>
        <DialogButton type="submit" :loading="busy" data-testid="prompt-submit" :disabled="busy">{{ request.confirm }}</DialogButton>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
