<script setup lang="ts">
import { CircleHelp, TriangleAlert } from "@lucide/vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { useTask } from "@tavora/official-ui/use-task";
import { closeDialog, dialog, type ConfirmRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

// As the app's own dialog (`dialog` in host.ts), or, with `nested`, over a dialog that stays open: then it only says
// `close` and its owner takes it away.
const props = defineProps<{ request: ConfirmRequest; nested?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const task = useTask({ describe: () => t("error.generic") });

async function run() {
  const error = await task.run(() => props.request.run());
  if (error === undefined) return;
  if (error) return task.fail(error);
  // Closed meanwhile (Escape, Cancel): the work went on, and whatever is shown now stays.
  if (props.nested) emit("close");
  else closeDialog(props.request);
}

function cancel() {
  if (props.nested) emit("close");
  else dialog.value = null;
}
</script>

<template>
  <ModalDialog :title="request.title" :description="request.message" :icon="request.danger ? TriangleAlert : CircleHelp" testid="confirm" :status="task.state.value.status" @close="cancel">
    <p v-if="task.error.value" class="text-destructive text-sm" role="alert">{{ task.error.value }}</p>
    <DialogFooter>
      <DialogButton type="button" close autofocus @click="cancel">{{ t("common.cancel") }}</DialogButton>
      <DialogButton
        type="button"
        :variant="request.danger ? 'destructive' : 'default'"
        :busy="task.busy.value"
        data-testid="confirm-submit"
        :disabled="task.busy.value"
        @click="run"
      >
        {{ request.confirm }}
      </DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
