<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, XCircle } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Badge>New</Badge>
    <Badge variant="secondary">Official</Badge>
    <Badge variant="outline">Local</Badge>
    <Badge variant="success"><CheckCircle2 :stroke-width="2" /> Saved</Badge>
    <Badge variant="warning"><AlertTriangle :stroke-width="2" /> Low space</Badge>
    <Badge variant="info"><Info :stroke-width="2" /> Beta</Badge>
    <Badge variant="destructive"><XCircle :stroke-width="2" /> Failed</Badge>
  </div>
</template>
