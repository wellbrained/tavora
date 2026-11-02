<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { useId } from "vue";

defineProps<{ disabled?: boolean }>();

const id = useId();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id">Module id</Label>
    <Input :id="id" model-value="tavora.notes" class="font-mono" :disabled="disabled" />
  </div>
</template>
