<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-mono">Monospace</Label>
    <Input id="pg-mono" model-value="tavora.notes" class="font-mono" :disabled="off" />
  </div>
</template>
