<script setup lang="ts">
import { CircleHelp, TriangleAlert } from "@lucide/vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { useTask } from "@tavora/official-ui/use-task";
import { closeDialog, dialog, type ConfirmRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: ConfirmRequest }>();
const task = useTask({ describe: () => t("error.generic") });

async function run() {
  const error = await task.run(() => props.request.run());
  if (error === undefined) return;
  if (error) return task.fail(error);
  // Closed meanwhile (Escape, Cancel): the work went on, and whatever is shown now stays.
  closeDialog(props.request);
}
</script>

<template>
  <ModalDialog :title="request.title" :description="request.message" :icon="request.danger ? TriangleAlert : CircleHelp" testid="confirm" :status="task.state.value.status" @close="dialog = null">
    <p v-if="task.error.value" class="text-destructive text-sm" role="alert">{{ task.error.value }}</p>
    <DialogFooter>
      <DialogButton type="button" close autofocus @click="dialog = null">{{ t("common.cancel") }}</DialogButton>
      <DialogButton
        type="button"
        :variant="request.danger ? 'destructive' : 'default'"
        :loading="task.busy.value"
        data-testid="confirm-submit"
        :disabled="task.busy.value"
        @click="run"
      >
        {{ request.confirm }}
      </DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
