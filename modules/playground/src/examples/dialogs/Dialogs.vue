<script setup lang="ts">
import { Pencil, Save, Share2, Trash2 } from "@lucide/vue";
import { ConfirmDialog, NameDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const name = ref("Waystone");
const confirming = ref(false);
const renaming = ref(false);
const renamingBusy = ref(false);
/** "New from a save": picking a (pretend) save fills the name and turns Save on; typing first keeps the typed name. */
const fromSave = ref(false);
const pickedSave = ref("");
const pickSave = () => (pickedSave.value = "Waystone Camp");
const sharing = ref(false);
const savingConfirm = ref(false);
const working = ref(false);
/** A pretend save: locks the dialog for a moment, then runs `done`. */
function slow(done: () => void) {
  working.value = true;
  setTimeout(() => {
    working.value = false;
    done();
  }, 1500);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" :disabled="off" @click="renaming = true">Rename…</Button>
    <Button variant="secondary" :disabled="off" @click="renamingBusy = true">Rename with a slow save…</Button>
    <Button variant="secondary" :disabled="off" @click="pickedSave = ''; fromSave = true">New from a save…</Button>
    <Button variant="secondary" :disabled="off" @click="sharing = true">Share (plain confirm)…</Button>
    <Button variant="secondary" :disabled="off" @click="savingConfirm = true">Slow confirm…</Button>
    <Button variant="secondary" class="text-destructive" :disabled="off" @click="confirming = true">Delete group…</Button>
  </div>
  <NameDialog
    v-model:open="renaming"
    title="Rename note"
    :icon="Pencil"
    :confirm-icon="Save"
    description="The new name shows in the list and the panel tab."
    label="Name"
    :value="name"
    :max-length="30"
    confirm="Rename"
    @submit="(value: string) => { name = value; renaming = false; }"
  />
  <NameDialog v-model:open="renamingBusy" title="Rename note" label="Name" :value="name" confirm="Rename" :busy="working" @submit="slow(() => (renamingBusy = false))">
    <p class="text-muted-foreground text-xs">Extra fields go here.</p>
  </NameDialog>
  <NameDialog v-model:open="fromSave" title="New build" label="Name" :value="pickedSave" :ready="!!pickedSave" placeholder="Pick a save first" confirm="Create" @submit="fromSave = false">
    <Button type="button" variant="secondary" data-testid="pick-save" @click="pickSave">Pick a save…</Button>
  </NameDialog>
  <ConfirmDialog v-model:open="sharing" tone="default" title="Share this note?" :icon="Share2" description="Anyone with the link can read it." confirm="Share" @confirm="sharing = false" />
  <ConfirmDialog v-model:open="savingConfirm" tone="default" title="Save changes?" description="This takes a moment." confirm="Save" :busy="working" @confirm="slow(() => (savingConfirm = false))" />
  <ConfirmDialog
    v-if="confirming"
    title="Delete “Act 2”?"
    description="Its 4 to-dos are removed for good. This cannot be undone."
    confirm="Delete group"
    :confirm-icon="Trash2"
    @confirm="confirming = false"
    @cancel="confirming = false"
  />
</template>
