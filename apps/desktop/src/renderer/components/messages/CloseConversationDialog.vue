<script setup lang="ts">
// The developer closes a conversation with an outcome the user sees.
import { CircleCheck } from "@lucide/vue";
import { computed, ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { useTask } from "@tavora/official-ui/use-task";
import { OUTCOMES, type Outcome } from "../../../shared/conversations";
import { act } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; done: [] }>();

const outcome = ref<Outcome>("fixed");
/** The work behind the button: it always ends (a throw shows as an error), so the button is usable again. */
const task = useTask({ describe: () => t("error.generic") });
const busy = task.busy;
/** The service's own answer when it did not go through; a request that threw is the task's error. */
const answered = ref<string | null>(null);
const error = computed(() => answered.value ?? task.error.value);

async function close() {
  answered.value = null;
  const result = await task.run(() => act({ type: "inbox-close", id: props.id, outcome: outcome.value }, { quiet: true }));
  if (!result) return;
  if (!result.ok) {
    answered.value = result.error;
    return;
  }
  emit("done");
  emit("close");
}
</script>

<template>
  <ModalDialog :title="t('inbox.close.title')" :description="t('inbox.close.outcome')" :icon="CircleCheck" testid="close-conversation" :status="task.state.value.status" @close="emit('close')">
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
