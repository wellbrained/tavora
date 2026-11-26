<script setup lang="ts">
import { Card } from "@tavora/official-ui/components/ui/card";
import { ref } from "vue";

const opened = ref("");
</script>

<template>
  <div class="grid max-w-xl gap-3 sm:grid-cols-2">
    <Card interactive title="Open the planner" description="Plan a factory step by step." data-testid="card-interactive" @click="opened = 'planner'" />
    <Card interactive disabled disabled-reason="Sign in first." title="Share" description="Send it to a friend." />
  </div>
  <p v-if="opened" class="text-muted-foreground mt-2 text-sm">Opened: {{ opened }}</p>
</template>
