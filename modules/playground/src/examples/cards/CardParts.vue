<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Card } from "@tavora/official-ui/components/ui/card";
import { Badge } from "@tavora/official-ui/components/ui/badge";
</script>

<template>
  <Card title="Lightning Arrow Deadeye" description="Fast clear, scales well into the atlas." class="max-w-sm">
    <template #action>
      <Badge variant="secondary">League start</Badge>
    </template>
    <p class="text-sm">Level 1 to 92, 14 passive points to spare.</p>
    <template #footer>
      <span class="flex-1">Updated 2 days ago</span>
      <Button size="sm" variant="ghost">Open</Button>
    </template>
  </Card>
</template>
