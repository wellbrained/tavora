<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogButton, DialogFooter, DialogHeader, DialogScrollContent } from "@tavora/official-ui/components/ui/dialog";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const reading = ref(false);
</script>

<template>
  <Button variant="secondary" :disabled="disabled" data-testid="long-dialog" @click="reading = true">Long dialog…</Button>
  <Dialog v-model:open="reading">
    <DialogScrollContent class="sm:max-w-[420px]">
      <DialogHeader title="Patch notes" description="A long text pushes the dialog past the window; the page scrolls." />
      <p v-for="n in 14" :key="n" class="text-muted-foreground text-sm">Line {{ n }}: a few friendly words about what changed, so there is something to scroll past.</p>
      <DialogFooter>
        <DialogButton close @click="reading = false">Done</DialogButton>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
