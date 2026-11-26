<script setup lang="ts">
import { CheckCard } from "@tavora/official-ui/components/ui/card";
import { ref } from "vue";

const notes = ref(true);
const todos = ref(false);
</script>

<template>
  <div class="grid max-w-xl grid-cols-2 gap-3">
    <CheckCard v-model="notes" title="Notes" description="Write things down." data-testid="check-card" />
    <CheckCard v-model="todos" title="To-dos" description="Lists and reminders." />
  </div>
</template>
