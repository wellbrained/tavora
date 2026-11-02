<script setup lang="ts">
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <Collapsible class="w-full max-w-md rounded-md border px-3 py-2">
      <CollapsibleTrigger class="py-1" :disabled="disabled">Notes</CollapsibleTrigger>
      <CollapsibleContent class="text-muted-foreground pt-2 pb-1 text-sm">Swap the second gem once you reach level 40.</CollapsibleContent>
    </Collapsible>
    <Collapsible default-open class="w-full max-w-md rounded-md border px-3 py-2">
      <CollapsibleTrigger class="py-1" :disabled="disabled">Skill tree info</CollapsibleTrigger>
      <CollapsibleContent class="text-muted-foreground pt-2 pb-1 text-sm">118 points spent, 12 in the Deadeye ascendancy.</CollapsibleContent>
    </Collapsible>
  </div>
</template>
