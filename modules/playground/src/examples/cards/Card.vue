<script setup lang="ts">
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Card } from "@tavora/official-ui/components/ui/card";
</script>

<template>
  <div class="grid max-w-2xl gap-3 sm:grid-cols-3">
    <Card size="sm" title="Small" description="Tight, for a grid of many." data-testid="card" />
    <Card title="Default" description="Fast clear, cheap to start." />
    <Card size="lg" title="Large">
      <p class="text-muted-foreground text-sm">Roomy, for a panel on its own. Anything can go inside.</p>
      <Badge variant="secondary" class="self-start">League start</Badge>
    </Card>
  </div>
</template>
