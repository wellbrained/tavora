<script setup lang="ts">
// Asks why, for Decline and Ban: one of the five reasons and an optional note. The developer gets both by email.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { ref } from "vue";
import { REASONS } from "../format";
import type { DeclineReason } from "../types";

defineProps<{ title: string; description: string; confirm: string }>();
const emit = defineEmits<{ confirm: [reason: DeclineReason, note: string]; cancel: [] }>();

const OPTIONS = (Object.entries(REASONS) as [DeclineReason, string][]).map(([value, label]) => ({ value, label }));
const MAX_NOTE = 500;

const reason = ref<DeclineReason>("unsafe");
const note = ref("");
</script>

<template>
  <Dialog :open="true" @update:open="(open) => !open && emit('cancel')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <form class="flex flex-col gap-4" @submit.prevent="emit('confirm', reason, note.trim())">
        <div class="flex flex-col gap-1.5">
          <Label for="reason">Reason</Label>
          <Select v-model="reason">
            <SelectTrigger id="reason" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="note">Note for the developer (optional)</Label>
          <Textarea id="note" v-model="note" :maxlength="MAX_NOTE" rows="3" placeholder="What to fix, in a sentence or two." />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" @click="emit('cancel')">Cancel</Button>
          <Button type="submit" variant="danger">{{ confirm }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
