<script setup lang="ts">
// The divider and padding sit on the content, so they grow and shrink with it. force-mount keeps the content in the
// page while closed, hidden from view and from the keyboard.
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
</script>

<template>
  <div class="flex flex-col gap-2">
    <Collapsible class="w-full max-w-md overflow-hidden rounded-md border">
      <CollapsibleTrigger class="px-3 py-2">More about this build</CollapsibleTrigger>
      <CollapsibleContent class="bg-muted/40 text-muted-foreground border-t px-3 py-2 text-sm">
        <p>Leveling is quickest through the first three acts with a spark setup.</p>
        <p class="mt-2">Swap to the boss setup before the last act.</p>
      </CollapsibleContent>
    </Collapsible>
    <Collapsible class="w-full max-w-md overflow-hidden rounded-md border">
      <CollapsibleTrigger class="px-3 py-2">Kept in the page</CollapsibleTrigger>
      <CollapsibleContent force-mount class="text-muted-foreground border-t px-3 py-2 text-sm" data-testid="collapsible-forced">Still in the page while closed, hidden from view and from the keyboard.</CollapsibleContent>
    </Collapsible>
    <p class="text-muted-foreground text-xs">This line moves along with the sections above.</p>
  </div>
</template>
