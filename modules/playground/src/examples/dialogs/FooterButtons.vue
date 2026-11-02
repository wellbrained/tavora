<script setup lang="ts">
// The three footer patterns: an action and Close, Cancel and an action, only Done.
import { Copy, Download, SlidersHorizontal, Share2, Upload } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { ref } from "vue";

const exporting = ref(false);
const importing = ref(false);
const tidying = ref(false);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" @click="exporting = true">Action + Close…</Button>
    <Button variant="secondary" @click="importing = true">Cancel + action…</Button>
    <Button variant="secondary" @click="tidying = true">Only Done…</Button>
  </div>
  <Dialog v-model:open="exporting">
    <DialogContent class="top-[12vh] translate-y-0 sm:max-w-[420px]">
      <DialogHeader :icon="Share2" title="Share this note" description="Pick how it leaves Tavora." />
      <div class="flex flex-col gap-2">
        <Input model-value="https://tavora.app/n/waystone" readonly aria-label="Link" />
      </div>
      <DialogFooter>
        <DialogButton close>Close</DialogButton>
        <DialogButton :icon="Copy" @click="toast({ title: 'Link copied' })">Copy link</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog v-model:open="importing">
    <DialogContent class="top-[12vh] translate-y-0 sm:max-w-[420px]">
      <DialogHeader :icon="Download" title="Import a build" description="Paste a build link or open a saved file." />
      <Input placeholder="https://" aria-label="Build link" />
      <DialogFooter>
        <DialogButton close @click="importing = false">Cancel</DialogButton>
        <DialogButton :icon="Upload" @click="importing = false">Import</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog v-model:open="tidying">
    <DialogContent class="top-[12vh] translate-y-0 sm:max-w-[420px]">
      <DialogHeader :icon="SlidersHorizontal" title="Settings" description="Changes save as you make them." />
      <div class="text-muted-foreground flex flex-col gap-1 text-sm">
        <span>Nothing to confirm here.</span>
      </div>
      <DialogFooter>
        <DialogButton close @click="tidying = false">Done</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
