<script setup lang="ts">
// NameDialog asks for a name: it selects the text on open, counts against a limit, and locks while `busy`.
import { Pencil, Save } from "@lucide/vue";
import { NameDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

const name = ref("Waystone");
const renaming = ref(false);
const renamingSlowly = ref(false);
const working = ref(false);
/** "New from a save": picking a (pretend) save fills the name and turns Create on; typing first keeps the typed name. */
const fromSave = ref(false);
const pickedSave = ref("");

/** A pretend save: locks the dialog for a moment, then closes it. */
function saveSlowly() {
  working.value = true;
  setTimeout(() => {
    working.value = false;
    renamingSlowly.value = false;
  }, 1500);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" @click="renaming = true">Rename…</Button>
    <Button variant="secondary" @click="renamingSlowly = true">Rename with a slow save…</Button>
    <Button variant="secondary" @click="pickedSave = ''; fromSave = true">New from a save…</Button>
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
  <NameDialog v-model:open="renamingSlowly" title="Rename note" label="Name" :value="name" confirm="Rename" :busy="working" @submit="saveSlowly">
    <p class="text-muted-foreground text-xs">Extra fields go here.</p>
  </NameDialog>
  <NameDialog v-model:open="fromSave" title="New build" label="Name" :value="pickedSave" :ready="!!pickedSave" placeholder="Pick a save first" confirm="Create" @submit="fromSave = false">
    <Button type="button" variant="secondary" data-testid="pick-save" @click="pickedSave = 'Waystone Camp'">Pick a save…</Button>
  </NameDialog>
</template>
