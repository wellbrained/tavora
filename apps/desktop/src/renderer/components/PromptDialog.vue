<script setup lang="ts">
import { computed, ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Pencil } from "@lucide/vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { useTask } from "@tavora/official-ui/use-task";
import { closeDialog, dialog, type PromptRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: PromptRequest }>();
const value = ref(props.request.value);
/** The work behind the button: it always ends (a throw shows as an error), so the button is usable again. */
const task = useTask({ describe: () => t("error.generic") });
const busy = task.busy;
/** The service's own answer when it did not go through; a request that threw is the task's error. */
const answered = ref<string | null>(null);
const error = computed(() => answered.value ?? task.error.value);

async function submit() {
  answered.value = null;
  const message = await task.run(() => props.request.submit(value.value));
  if (message === undefined) return;
  answered.value = message;
  if (!message) closeDialog(props.request);
}
</script>

<template>
  <ModalDialog :title="request.title" :icon="Pencil" testid="prompt" :status="task.state.value.status" @close="dialog = null">
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
