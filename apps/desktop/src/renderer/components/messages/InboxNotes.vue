<script setup lang="ts">
// The notes about the inbox, one at a time: why the icon appeared (by cause) or went away, and the one-time note for
// developers. Their texts come from the service (editable by the admin) or are built in. Each shows once.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, inbox } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";
import NoteText from "./NoteText.vue";

const note = computed(() => inbox.value.note);
const developerNote = computed(() => !note.value && inbox.value.developerNote);

function done() {
  void act({ type: note.value ? "inbox-note-seen" : "inbox-developer-note-seen" }, { quiet: true });
}
</script>

<template>
  <ModalDialog v-if="note" :title="note.kind === 'gone' ? t('inbox.note.goneTitle') : t('inbox.note.appearedTitle')" testid="inbox-note" @close="done">
    <div class="text-muted-foreground space-y-2 text-sm"><NoteText :paragraphs="note.paragraphs" /></div>
    <div class="flex justify-end"><Button data-testid="inbox-note-ok" @click="done">{{ t("inbox.note.ok") }}</Button></div>
  </ModalDialog>
  <ModalDialog v-else-if="developerNote" :title="t('inbox.developerNote.title')" testid="inbox-developer-note" @close="done">
    <div class="text-muted-foreground space-y-2 text-sm">
      <p>{{ t("inbox.developerNote.contact") }}</p>
      <p>{{ t("inbox.developerNote.icon") }}</p>
      <p>{{ t("inbox.developerNote.email") }}</p>
      <p>{{ t("inbox.developerNote.off") }}</p>
    </div>
    <div class="flex justify-end"><Button data-testid="inbox-developer-note-ok" @click="done">{{ t("inbox.note.ok") }}</Button></div>
  </ModalDialog>
</template>
