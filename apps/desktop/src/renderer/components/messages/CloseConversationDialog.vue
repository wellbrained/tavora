<script setup lang="ts">
// The developer closes a conversation with an outcome the user sees.
import { CircleCheck } from "@lucide/vue";
import { ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { OUTCOMES, type Outcome } from "../../../shared/conversations";
import { act } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; done: [] }>();

const outcome = ref<Outcome>("fixed");
const busy = ref(false);
const error = ref<string | null>(null);

async function close() {
  busy.value = true;
  const result = await act({ type: "inbox-close", id: props.id, outcome: outcome.value }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  emit("done");
  emit("close");
}
</script>

<template>
  <ModalDialog :title="t('inbox.close.title')" :description="t('inbox.close.outcome')" :icon="CircleCheck" testid="close-conversation" @close="emit('close')">
    <form class="contents" @submit.prevent="close">
      <div class="grid gap-4">
      <RadioGroup v-model="outcome" class="gap-2" :aria-label="t('inbox.close.outcome')">
        <Label v-for="option in OUTCOMES" :key="option" class="font-normal">
          <RadioGroupItem :value="option" :data-testid="`close-outcome-${option}`" />
          {{ t(`inbox.outcome.${option}`) }}
        </Label>
      </RadioGroup>
      <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
      </div>
      <DialogFooter>
        <DialogButton type="button" close @click="emit('close')">{{ t("common.cancel") }}</DialogButton>
        <DialogButton type="submit" :loading="busy" :disabled="busy" data-testid="close-conversation-submit">{{ t("inbox.close") }}</DialogButton>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
