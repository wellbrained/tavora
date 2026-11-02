<script setup lang="ts">
import { CircleHelp, TriangleAlert } from "@lucide/vue";
import { ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { dialog, type ConfirmRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: ConfirmRequest }>();
const error = ref<string | null>(null);
const busy = ref(false);

async function run() {
  busy.value = true;
  error.value = await props.request.run();
  busy.value = false;
  if (!error.value) dialog.value = null;
}
</script>

<template>
  <ModalDialog :title="request.title" :description="request.message" :icon="request.danger ? TriangleAlert : CircleHelp" testid="confirm" @close="dialog = null">
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <DialogFooter>
      <DialogButton type="button" close autofocus @click="dialog = null">{{ t("common.cancel") }}</DialogButton>
      <DialogButton
        type="button"
        :variant="request.danger ? 'destructive' : 'default'"
        :loading="busy"
        data-testid="confirm-submit"
        :disabled="busy"
        @click="run"
      >
        {{ request.confirm }}
      </DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
