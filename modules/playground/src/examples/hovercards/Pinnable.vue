<script setup lang="ts">
// A card you can move into: it holds buttons. With `pinnable`, a click on the name pins it, with a close button in
// its corner; Escape or a click outside closes it. Tab from the name goes into the card.
import { Copy, Plus } from "@lucide/vue";
import { copyText, TooltipRows } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@tavora/official-ui/components/ui/hover-card";
import { ref } from "vue";

const added = ref(0);
const copied = ref(false);
async function copyName() {
  await copyText("Frost Ward").then(() => (copied.value = true), () => undefined);
}
</script>

<template>
  <p class="text-sm">
    Your build has
    <HoverCard pinnable>
      <HoverCardTrigger focusable class="font-medium underline decoration-dotted underline-offset-4">Frost Ward</HoverCardTrigger>
      <HoverCardContent title="Frost Ward" description="Covers you in ice that soaks up the next hits.">
        <hr />
        <TooltipRows :rows="[{ label: 'Cost', value: '40 mana' }, { label: 'Lasts', value: '12 s' }]" />
        <div class="mt-3 flex gap-2">
          <Button size="xs" @click="added++"><Plus /> Add to build</Button>
          <Button size="xs" variant="secondary" @click="copyName"><Copy /> {{ copied ? "Copied" : "Copy name" }}</Button>
        </div>
      </HoverCardContent>
    </HoverCard>
    <template v-if="added">, {{ added }} more added</template>.
  </p>
</template>
