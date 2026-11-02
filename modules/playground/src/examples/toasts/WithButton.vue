<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" @click="toast({ title: 'To-do deleted', action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })">With Undo</Button>
    <Button variant="secondary" @click="toast({ title: 'Deleted “Shopping”', duration: 10000, action: { label: 'Undo', onClick: () => toast({ title: 'Brought back' }) } })">Long Undo (10 s)</Button>
    <Button variant="secondary" @click="toast({ title: 'Note deleted', description: '“Boss route” is gone.' })">Second line</Button>
  </div>
</template>
