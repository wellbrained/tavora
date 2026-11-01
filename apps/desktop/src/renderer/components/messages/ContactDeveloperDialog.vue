<script setup lang="ts">
// Contact the developer: a request (bug report, feature request or question) to the developer of a catalog module. It
// needs a sign-in; the developer never sees who wrote. The Tavora and module version are filled in and shown before
// sending. If the developer chose another way (contactChoice), that is offered instead: a link opens with a warning
// that it leaves Tavora and isn't anonymous, an email address or Discord name can be copied; Nobody says so.
import { LogIn, MessageCircle, Send } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { MAX_MESSAGE_LENGTH, messageProblem, REQUEST_TYPES, type ContactDraft, type RequestType } from "../../../shared/conversations";
import { act, api, openInbox, openProfile, showToast } from "../../host";
import type { MessageKey } from "../../../shared/i18n";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ moduleId: string; moduleName: string; previousId?: string }>();
const emit = defineEmits<{ close: [] }>();

const draft = ref<ContactDraft | null>(null);
const kind = ref<RequestType>("bug");
const text = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  draft.value = await api.contactDraft(props.moduleId);
});

const length = computed(() => [...text.value.trim()].length);
const problem = computed(() => messageProblem(text.value));
const name = computed(() => (draft.value && "moduleName" in draft.value ? draft.value.moduleName : props.moduleName));

async function send() {
  if (problem.value || busy.value) return;
  busy.value = true;
  error.value = null;
  const result = await act({ type: "inbox-send-request", moduleId: props.moduleId, requestType: kind.value, text: text.value.trim(), ...(props.previousId ? { previousId: props.previousId } : {}) }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  emit("close");
  openInbox(result.id);
}

async function openLink() {
  const result = await act({ type: "open-contact-link", moduleId: props.moduleId }, { quiet: true });
  if (!result.ok) error.value = result.error;
  else if (result.id === "copied") showToast(t("contact.copied"));
  else emit("close");
}

function signIn() {
  emit("close");
  openProfile("account");
}
</script>

<template>
  <ModalDialog :title="t('contact.title', { name })" :icon="MessageCircle" class="sm:max-w-[480px]" testid="contact-dialog" @close="emit('close')">
    <p v-if="!draft" class="text-muted-foreground text-sm" role="status">{{ t("contact.loading") }}</p>

    <template v-else-if="draft.status === 'signed-out'">
      <p class="text-sm">{{ t("contact.signIn") }}</p>
      <DialogFooter>
        <DialogButton close @click="emit('close')">{{ t("common.cancel") }}</DialogButton>
        <DialogButton :icon="LogIn" data-testid="contact-sign-in" @click="signIn">{{ t("catalog.reviews.signInButton") }}</DialogButton>
      </DialogFooter>
    </template>

    <template v-else-if="draft.status === 'off'">
    <div class="grid gap-3" data-testid="contact-off">
      <template v-if="draft.value && draft.host">
        <p class="text-sm">{{ t(`contact.off.${draft.kind}` as MessageKey, { name }) }}</p>
        <Notice variant="warning">{{ t("contact.offWarning") }}</Notice>
        <Button variant="secondary" class="justify-self-start" data-testid="contact-link" @click="openLink">{{ t("contact.offLink", { host: draft.host }) }}</Button>
      </template>
      <template v-else-if="draft.value">
        <p class="text-sm">{{ t(`contact.off.${draft.kind}` as MessageKey, { name }) }}</p>
        <div class="flex items-center gap-2">
          <code class="bg-muted min-w-0 truncate rounded px-2 py-1 font-mono text-sm select-all" data-testid="contact-value">{{ draft.value }}</code>
          <Button variant="secondary" size="sm" data-testid="contact-copy" @click="openLink">{{ t("contact.copy") }}</Button>
        </div>
        <p class="text-muted-foreground text-sm">{{ t("contact.offNotAnonymous") }}</p>
      </template>
      <p v-else class="text-sm">{{ t("contact.offNone", { name }) }}</p>
      <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    </div>
    <DialogFooter><DialogButton close @click="emit('close')">{{ t("common.close") }}</DialogButton></DialogFooter>
    </template>

    <p v-else-if="draft.status !== 'ok'" class="text-destructive text-sm" role="alert">{{ draft.error ?? t("error.generic") }}</p>

    <form v-else class="contents" @submit.prevent="send">
      <div class="grid gap-4">
      <div class="grid gap-2">
        <Label class="text-muted-foreground font-normal">{{ t("contact.type") }}</Label>
        <RadioGroup v-model="kind" class="gap-2" :aria-label="t('contact.type')" data-testid="contact-type">
          <Label v-for="option in REQUEST_TYPES" :key="option" class="font-normal">
            <RadioGroupItem :value="option" :data-testid="`contact-type-${option}`" />
            {{ t(`contact.type.${option}`) }}
          </Label>
        </RadioGroup>
      </div>
      <div class="grid gap-1.5">
        <Textarea v-model="text" class="min-h-32 text-sm" :placeholder="t('contact.placeholder')" :aria-label="t('contact.placeholder')" :disabled="busy" data-testid="contact-text" />
        <p class="text-muted-foreground flex justify-between gap-3 text-xs">
          <span data-testid="contact-versions">{{ t("contact.versions", { tavora: draft.versions.tavora, name: draft.moduleName, module: draft.versions.module }) }}</span>
          <span class="flex-none" :class="length > MAX_MESSAGE_LENGTH && 'text-destructive'">{{ length }} / {{ MAX_MESSAGE_LENGTH }}</span>
        </p>
      </div>
      <p class="text-muted-foreground text-sm">{{ t("contact.anonymous") }}</p>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="contact-error">{{ error }}</p>
      </div>
      <DialogFooter>
        <DialogButton type="button" close @click="emit('close')">{{ t("common.cancel") }}</DialogButton>
        <DialogButton type="submit" :icon="Send" :loading="busy" :disabled="busy || problem !== null" data-testid="contact-send">{{ t("contact.send") }}</DialogButton>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
