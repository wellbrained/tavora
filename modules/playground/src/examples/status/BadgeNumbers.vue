<script setup lang="ts">
import { Badge } from "@tavora/official-ui/components/ui/badge";
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 text-sm">
    <span class="flex items-center gap-1.5">Trash <Badge variant="secondary" size="sm" numeric>12</Badge></span>
    <span class="flex items-center gap-1.5">Cast Screw <Badge variant="warning" size="sm">Alt</Badge></span>
    <Badge variant="outline" numeric>Level 33</Badge>
    <Badge variant="success" numeric>Won 33</Badge>
  </div>
</template>
