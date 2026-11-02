<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" :disabled="off" @click="toast({ title: 'Copied' })">Plain</Button>
    <Button variant="secondary" :disabled="off" @click="toast.success('Saved')">Success</Button>
    <Button variant="secondary" :disabled="off" @click="toast.info('Update ready', { action: { label: 'Restart', onClick: () => toast({ title: 'Restarting' }) } })">Info</Button>
    <Button variant="secondary" :disabled="off" @click="toast.warning('Almost out of space')">Warning</Button>
    <Button variant="secondary" :disabled="off" @click="toast.error('Can’t save right now')">Error</Button>
  </div>
</template>
