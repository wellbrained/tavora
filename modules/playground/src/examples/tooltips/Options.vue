<script setup lang="ts">
// useTooltip's options for a target:
// - `toggle`: an info button whose only job is the tip; a press opens and closes it, a tap too (touch has no hover).
// - `keepOnPress`: the card stays on a press, so a copy button's card can turn into "Copied".
// - `when: isTruncated`: a name gets a card only when it is cut short.
// - `align`: the card lines up with the start or end of a wide target, here a whole field and its "?".
import { CircleHelp, Copy } from "@lucide/vue";
import { isTruncated, Tooltip, useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";

const tip = useTooltip<string>();
const copied = ref(false);
function copy() {
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
const files = ["Notes.txt", "Raid plan for Thursday night with the whole guild.txt"];
</script>

<template>
  <div class="flex max-w-md flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="icon-sm" aria-label="About sharing" v-bind="tip.on('Anyone with the link can view it.', { toggle: true })" hinted><CircleHelp /></Button>
      <Button variant="outline" v-bind="tip.on(() => (copied ? 'Copied' : 'Copy the link'), { keepOnPress: true })" hinted @click="copy"><Copy />Copy</Button>
    </div>
    <ul class="flex w-48 flex-col gap-1 text-sm">
      <li v-for="file in files" :key="file" class="truncate" v-bind="tip.on(file, { when: isTruncated, focusable: true, as: 'label' })">{{ file }}</li>
    </ul>
    <div class="flex items-center gap-2" v-bind="tip.on('Paste the address Discord gave you.', { align: 'end', as: 'description' })">
      <Input placeholder="Webhook address" aria-label="Webhook address" />
      <CircleHelp class="text-muted-foreground size-4 flex-none" aria-hidden="true" />
    </div>
  </div>
  <Tooltip v-bind="tip.props" :description="tip.content ?? ''" compact />
</template>
