<script setup lang="ts">
// Report a conversation to Tavora: a reason and a note. Block is ticked by default; the other side is not told.
import { Flag } from "@lucide/vue";
import { computed, ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { CONVERSATION_REPORT_REASONS, MAX_NOTE_LENGTH, type ConversationReportReason } from "../../../shared/conversations";
import { act, showToast } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ id: string; canBlock: boolean }>();
const emit = defineEmits<{ close: []; done: [] }>();

const reason = ref<ConversationReportReason>("insults");
const note = ref("");
const block = ref(props.canBlock);
const busy = ref(false);
const error = ref<string | null>(null);
const noteLength = computed(() => [...note.value.trim()].length);
const tooLong = computed(() => noteLength.value > MAX_NOTE_LENGTH);

async function send() {
  if (busy.value || tooLong.value) return;
  busy.value = true;
  const report = { reason: reason.value, note: note.value.trim() || null };
  const result = await act(block.value && props.canBlock ? { type: "inbox-block", id: props.id, report } : { type: "inbox-report", id: props.id, report }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  showToast(t("inbox.report.done"));
  emit("done");
  emit("close");
}
</script>

<template>
  <ModalDialog :title="t('inbox.report.title')" :description="t('inbox.report.hint')" :icon="Flag" testid="report-conversation" @close="emit('close')">
    <form class="contents" @submit.prevent="send">
      <div class="grid gap-4">
      <RadioGroup v-model="reason" class="gap-2" :aria-label="t('inbox.report.title')">
        <Label v-for="option in CONVERSATION_REPORT_REASONS" :key="option" class="font-normal">
          <RadioGroupItem :value="option" :data-testid="`report-conversation-${option}`" />
          {{ option === "other" ? t("inbox.report.reasonElse") : t(`inbox.report.reason.${option}`) }}
        </Label>
      </RadioGroup>
      <div class="grid gap-1.5">
        <Textarea v-model="note" class="min-h-20 text-sm" :placeholder="t('report.note')" :aria-label="t('report.note')" :disabled="busy" data-testid="report-conversation-note" />
        <p class="text-muted-foreground text-right text-xs" :class="tooLong && 'text-destructive'">{{ noteLength }} / {{ MAX_NOTE_LENGTH }}</p>
      </div>
      <Label v-if="canBlock" class="font-normal">
        <Checkbox v-model="block" data-testid="report-conversation-block" />
        {{ t("inbox.report.block") }}
      </Label>
      <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
      </div>
      <DialogFooter>
        <DialogButton type="button" close @click="emit('close')">{{ t("common.cancel") }}</DialogButton>
        <DialogButton type="submit" :icon="Flag" :loading="busy" :disabled="busy || tooLong" data-testid="report-conversation-send">{{ t("inbox.report") }}</DialogButton>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
