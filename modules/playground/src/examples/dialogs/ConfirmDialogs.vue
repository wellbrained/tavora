<script setup lang="ts">
// ConfirmDialog asks before something happens. It is red by default; tone="default" is the plain one.
import { Share2, Trash2 } from "@lucide/vue";
import { ConfirmDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

const sharing = ref(false);
const saving = ref(false);
const working = ref(false);
const deleting = ref(false);

/** A pretend save: locks the dialog for a moment, then closes it. */
function saveSlowly() {
  working.value = true;
  setTimeout(() => {
    working.value = false;
    saving.value = false;
  }, 1500);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" @click="sharing = true">Share (plain confirm)…</Button>
    <Button variant="secondary" @click="saving = true">Slow confirm…</Button>
    <Button variant="secondary" class="text-destructive" @click="deleting = true">Delete group…</Button>
  </div>
  <ConfirmDialog v-model:open="sharing" tone="default" title="Share this note?" :icon="Share2" description="Anyone with the link can read it." confirm="Share" @confirm="sharing = false" />
  <ConfirmDialog v-model:open="saving" tone="default" title="Save changes?" description="This takes a moment." confirm="Save" :busy="working" @confirm="saveSlowly" />
  <ConfirmDialog
    v-if="deleting"
    title="Delete “Act 2”?"
    description="Its 4 to-dos are removed for good. This cannot be undone."
    confirm="Delete group"
    :confirm-icon="Trash2"
    @confirm="deleting = false"
    @cancel="deleting = false"
  />
</template>
