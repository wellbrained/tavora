<script setup lang="ts">
// A dialog that holds typed text isn't closed by Escape, a click outside or the X: `dismissible` is off while there is
// text, and each try asks before it throws the text away. While Save runs, `busy` keeps it open and turns the X off.
import { NotebookPen, Save } from "@lucide/vue";
import { ConfirmDialog } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { useTask } from "@tavora/official-ui/use-task";
import { ref } from "vue";

const writing = ref(false);
const asking = ref(false);
const text = ref("");
const saver = useTask();

function open() {
  text.value = "";
  writing.value = true;
}

function close() {
  asking.value = false;
  writing.value = false;
}

/** A pretend save: a moment of work, then the dialog closes. */
async function save() {
  await saver.run(() => new Promise((resolve) => setTimeout(resolve, 1500)));
  writing.value = false;
}
</script>

<template>
  <Button variant="secondary" data-testid="ask-before-closing" @click="open">Write a note…</Button>
  <Dialog v-model:open="writing">
    <DialogContent
      class="top-[12vh] translate-y-0 sm:max-w-[420px]"
      :dismissible="!text.trim()"
      :busy="saver.busy.value"
      :data-status="saver.state.value.status"
      @dismiss-attempt="asking = true"
    >
      <DialogHeader :icon="NotebookPen" title="New note" description="Type something, then try Escape or a click outside." />
      <Textarea v-model="text" placeholder="Your note" aria-label="Note" :disabled="saver.busy.value" />
      <DialogFooter>
        <DialogButton close :disabled="saver.busy.value" @click="text.trim() ? (asking = true) : close()">Cancel</DialogButton>
        <DialogButton :loading="saver.busy.value" :disabled="saver.busy.value || !text.trim()" @click="save">Save</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <ConfirmDialog
    v-model:open="asking"
    title="Discard your note?"
    description="What you typed is gone then."
    confirm="Discard"
    cancel="Keep writing"
    @confirm="close"
  />
</template>
