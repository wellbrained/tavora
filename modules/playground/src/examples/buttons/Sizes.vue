<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button size="xs" :disabled="off">Extra small</Button>
    <Button size="xs" variant="secondary" :disabled="off">Extra small</Button>
    <Button size="sm" variant="secondary" :disabled="off">Small</Button>
    <Button variant="secondary" :disabled="off">Default</Button>
    <Button size="lg" variant="secondary" :disabled="off">Large</Button>
  </div>
</template>
