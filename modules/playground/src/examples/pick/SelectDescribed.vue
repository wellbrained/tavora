<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

const reach = ref("tavora");
</script>

<template>
  <Select v-model="reach">
    <SelectTrigger class="w-56" aria-label="How users can reach you" data-testid="select-described">
      <SelectValue />
    </SelectTrigger>
    <SelectContent class="max-w-80">
      <SelectItem value="tavora" description="Users write to you here. You won't see who they are.">In Tavora</SelectItem>
      <SelectItem value="email" description="Users get your email address.">Email</SelectItem>
      <SelectItem value="none" description="No contact button at all.">Nobody</SelectItem>
    </SelectContent>
  </Select>
</template>
