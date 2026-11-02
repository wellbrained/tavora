<script setup lang="ts">
// toast() shows in the page's <Toaster />, which follows the toast position the user picked.
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" @click="toast({ title: 'Copied' })">Plain</Button>
    <Button variant="secondary" @click="toast.success('Saved')">Success</Button>
    <Button variant="secondary" @click="toast.info('Update ready', { action: { label: 'Restart', onClick: () => toast({ title: 'Restarting' }) } })">Info</Button>
    <Button variant="secondary" @click="toast.warning('Almost out of space')">Warning</Button>
    <Button variant="secondary" @click="toast.error('Can’t save right now')">Error</Button>
  </div>
</template>
