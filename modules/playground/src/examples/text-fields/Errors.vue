<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <Label for="pg-error">With an error</Label>
      <Input id="pg-error" model-value="ab" aria-invalid="true" aria-describedby="pg-error-text" :disabled="off" />
      <p id="pg-error-text" class="text-destructive text-xs">Use at least three characters.</p>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label for="pg-error-area">Text area with an error</Label>
      <Textarea id="pg-error-area" model-value="Hi" aria-invalid="true" aria-describedby="pg-error-area-text" :disabled="off" />
      <p id="pg-error-area-text" class="text-destructive text-xs">Write at least a sentence.</p>
    </div>
  </div>
</template>
