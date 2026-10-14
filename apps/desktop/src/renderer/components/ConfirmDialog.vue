<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { dialog, type ConfirmRequest } from "../host";
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
  <ModalDialog :title="request.title" :description="request.message" testid="confirm" @close="dialog = null">
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" autofocus @click="dialog = null">Cancel</Button>
      <Button
        type="button"
        :variant="request.danger ? 'destructive' : 'default'"
        data-testid="confirm-submit"
        :disabled="busy"
        @click="run"
      >
        {{ request.confirm }}
      </Button>
    </div>
  </ModalDialog>
</template>
