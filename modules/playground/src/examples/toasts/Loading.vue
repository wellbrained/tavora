<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";

defineProps<{ disabled?: boolean }>();

/** A pretend save: done, or failed, after a moment. */
const wait = (ms: number, fail = false) => new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(new Error("failed")) : resolve()), ms));
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="secondary" :disabled="disabled" @click="toast.promise(wait(1500), { loading: 'Saving…', success: 'Saved', error: 'Can’t save' })">Works</Button>
    <Button variant="secondary" :disabled="disabled" @click="toast.promise(wait(1500, true), { loading: 'Saving…', success: 'Saved', error: 'Can’t save' }).catch(() => undefined)">Fails</Button>
  </div>
</template>
