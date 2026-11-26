<script setup lang="ts">
// The four widths (size) and the top position (anchor), with the same content so only the width changes.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader, type DialogSize } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";

const sizes: { size: DialogSize; label: string }[] = [
  { size: "sm", label: "Small · 360" },
  { size: "md", label: "Medium · 420" },
  { size: "lg", label: "Large · 560" },
  { size: "xl", label: "Extra large · 760" },
];
const open = ref<DialogSize | null>(null);
const top = ref(false);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button v-for="item in sizes" :key="item.size" variant="secondary" :data-testid="`dialog-size-${item.size}`" @click="open = item.size">{{ item.label }}</Button>
    <Button variant="secondary" data-testid="dialog-anchor-top" @click="top = true">Near the top</Button>
  </div>
  <Dialog :open="open !== null" @update:open="value => { if (!value) open = null }">
    <DialogContent :size="open ?? 'md'" :data-testid="`dialog-${open}`">
      <DialogHeader title="Name this plan" description="Pick a name you will recognise later." />
      <Input model-value="Heavy modular frames" aria-label="Name" />
      <DialogFooter>
        <DialogButton close @click="open = null">Cancel</DialogButton>
        <DialogButton @click="open = null">Save</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  <Dialog v-model:open="top">
    <DialogContent anchor="top" data-testid="dialog-top">
      <DialogHeader title="A list that changes" description="The title stays where it is when the list grows." />
      <Input model-value="" placeholder="Search" aria-label="Search" />
      <DialogFooter>
        <DialogButton close @click="top = false">Done</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
