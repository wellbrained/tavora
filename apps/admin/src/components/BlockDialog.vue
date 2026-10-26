<script setup lang="ts">
// Asks why a zip gets blocked. Players read the reason in Tavora's message, so it is one plain sentence.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { computed, ref } from "vue";

const props = defineProps<{ name: string; version: string }>();
const emit = defineEmits<{ confirm: [reason: string]; cancel: [] }>();

const MAX_REASON = 300;
const reason = ref("");
const ready = computed(() => reason.value.trim().length > 0);
const preview = computed(() => `Tavora stopped ${props.name} ${props.version} because it can do harm: ${reason.value.trim() || "…"}`);
</script>

<template>
  <Dialog :open="true" @update:open="(open) => !open && emit('cancel')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Block {{ name }} {{ version }}?</DialogTitle>
        <DialogDescription>Once you sign the blocks list, this zip turns off for every player. Their data stays.</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="ready && emit('confirm', reason.trim())">
        <div class="flex flex-col gap-1.5">
          <Label for="block-reason">Why, for players</Label>
          <Input id="block-reason" v-model="reason" :maxlength="MAX_REASON" placeholder="It sends your files to a stranger." autocomplete="off" autofocus />
          <p class="text-muted-foreground text-xs">{{ preview }}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="emit('cancel')">Cancel</Button>
          <Button type="submit" variant="danger" :disabled="!ready">Block</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
