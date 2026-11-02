<script setup lang="ts">
import { Copy, Pencil, Pin, Plus, Settings } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button size="icon-xs" variant="ghost" aria-label="Pin" title="Pin" :disabled="off"><Pin :stroke-width="1.5" /></Button>
    <Button size="icon-xs" variant="secondary" aria-label="Copy" title="Copy" :disabled="off"><Copy :stroke-width="1.5" /></Button>
    <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit" :disabled="off"><Pencil :stroke-width="1.5" /></Button>
    <Button size="icon" variant="secondary" aria-label="Settings" title="Settings" :disabled="off"><Settings :stroke-width="1.5" /></Button>
    <Button size="icon-lg" variant="outline" aria-label="Add" title="Add" :disabled="off"><Plus :stroke-width="1.5" /></Button>
  </div>
</template>
