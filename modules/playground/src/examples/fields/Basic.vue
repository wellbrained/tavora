<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref, useId } from "vue";

defineProps<{ disabled?: boolean }>();

const id = useId();
const name = ref("Waystone");
const text = ref("");
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <Label :for="`${id}-name`">Name</Label>
      <Input :id="`${id}-name`" v-model="name" :disabled="disabled" />
      <p class="text-muted-foreground text-xs">Shown in the panel tab.</p>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label :for="`${id}-empty`">With a placeholder</Label>
      <Input :id="`${id}-empty`" v-model="text" placeholder="Add a to-do" :disabled="disabled" />
    </div>
  </div>
</template>
