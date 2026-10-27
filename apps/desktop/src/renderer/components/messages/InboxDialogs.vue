<script setup lang="ts">
// The dialogs for messages that live at the top of the app: the inbox, its notes, and Report from Settings > Modules.
import { dialog, inboxOpen, noteShown } from "../../host";
import InboxDialog from "./InboxDialog.vue";
import InboxNotes from "./InboxNotes.vue";
import ReportModuleDialog from "./ReportModuleDialog.vue";
</script>

<template>
  <InboxDialog v-if="inboxOpen" />
  <InboxNotes v-if="noteShown" />
  <ReportModuleDialog v-if="dialog?.kind === 'report-module'" :key="dialog.moduleId" :module-id="dialog.moduleId" :module-name="dialog.name" @close="dialog = null" />
</template>
