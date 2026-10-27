<script setup lang="ts">
// Report a catalog module to Tavora: a reason and an optional note. It needs a sign-in; Tavora keeps who reported
// only while the report is open, and the developer is told only that the module was reported.
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { MAX_NOTE_LENGTH, MODULE_REPORT_REASONS, type ModuleReportReason } from "../../../shared/conversations";
import { account, act, openSettings, showToast } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ moduleId: string; moduleName: string }>();
const emit = defineEmits<{ close: []; reported: [] }>();

const reason = ref<ModuleReportReason>("unsafe");
const note = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const signedIn = computed(() => account.value?.account != null);
const noteLength = computed(() => [...note.value.trim()].length);
const tooLong = computed(() => noteLength.value > MAX_NOTE_LENGTH);

async function send() {
  if (busy.value || tooLong.value) return;
  busy.value = true;
  error.value = null;
  const result = await act({ type: "report-catalog-module", moduleId: props.moduleId, reason: reason.value, note: note.value.trim() || null }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  showToast(t("settings.modules.reported", { name: props.moduleName }));
  emit("reported");
  emit("close");
}

function signIn() {
  emit("close");
  openSettings({ section: "account" });
}
</script>

<template>
  <ModalDialog :title="t('report.title', { name: moduleName })" :description="t('catalog.reportHint')" testid="report-module-dialog" @close="emit('close')">
    <div v-if="!signedIn" class="grid gap-3">
      <p class="text-sm">{{ t("error.reportSignIn") }}</p>
      <div class="flex justify-end gap-2">
        <Button variant="secondary" @click="emit('close')">{{ t("common.cancel") }}</Button>
        <Button data-testid="report-sign-in" @click="signIn">{{ t("catalog.reviews.signInButton") }}</Button>
      </div>
    </div>
    <form v-else class="grid gap-4" @submit.prevent="send">
      <RadioGroup v-model="reason" class="gap-2" :aria-label="t('report.reason')" data-testid="report-reason">
        <Label v-for="option in MODULE_REPORT_REASONS" :key="option" class="font-normal">
          <RadioGroupItem :value="option" :data-testid="`report-reason-${option}`" />
          {{ option === "other" ? t("report.reasonElse") : t(`report.reason.${option}`) }}
        </Label>
      </RadioGroup>
      <div class="grid gap-1.5">
        <Textarea v-model="note" class="min-h-20 text-sm" :placeholder="t('report.note')" :aria-label="t('report.note')" :disabled="busy" data-testid="report-note" />
        <p class="text-muted-foreground text-right text-xs" :class="tooLong && 'text-destructive'">{{ noteLength }} / {{ MAX_NOTE_LENGTH }}</p>
      </div>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="report-error">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" @click="emit('close')">{{ t("common.cancel") }}</Button>
        <Button type="submit" :disabled="busy || tooLong" data-testid="report-send">{{ t("catalog.reportSend") }}</Button>
      </div>
    </form>
  </ModalDialog>
</template>
