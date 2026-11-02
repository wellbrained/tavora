<script setup lang="ts">
// aria-invalid turns the field red; aria-describedby reads the error out with it.
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { useId } from "vue";

const id = useId();
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <Label :for="`${id}-field`">With an error</Label>
      <Input :id="`${id}-field`" model-value="ab" aria-invalid="true" :aria-describedby="`${id}-field-error`" />
      <p :id="`${id}-field-error`" class="text-destructive text-xs">Use at least three characters.</p>
    </div>
    <div class="flex flex-col gap-1.5">
      <Label :for="`${id}-area`">Text area with an error</Label>
      <Textarea :id="`${id}-area`" model-value="Hi" aria-invalid="true" :aria-describedby="`${id}-area-error`" />
      <p :id="`${id}-area-error`" class="text-destructive text-xs">Write at least a sentence.</p>
    </div>
  </div>
</template>
