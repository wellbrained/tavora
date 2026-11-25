<script setup lang="ts">
// Buttons that run their work and say how it went. Copy is done at once, so it goes straight to "Copied". Save takes a
// while: a spinner after a moment, then "Saving…", then "Saved". Sync fails, so it goes back and a toast says why.
import { Copy, RefreshCw } from "@lucide/vue";
import { copyText } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const copy = () => copyText("TAV-7Q2X-91KM");
const save = () => wait(2600);
async function sync() {
  await wait(1400);
  throw new Error("Can't reach the server.");
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" :action="copy" done-label="Copied"><Copy /> Copy</Button>
    <Button :action="save" busy-label="Saving…" done-label="Saved">Save</Button>
    <Button variant="outline" :action="sync" busy-label="Syncing…" done-label="Synced"><RefreshCw /> Sync</Button>
    <Button size="icon" variant="ghost" aria-label="Copy the code" title="Copy the code" :action="copy" done-label="Copied"><Copy /></Button>
  </div>
</template>
