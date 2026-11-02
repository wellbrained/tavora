<script setup lang="ts">
import { CodeInput, codeDigits } from "@tavora/official-ui/components/ui/code-input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref, useId } from "vue";

defineProps<{ disabled?: boolean }>();

const id = useId();
const code = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id">Code</Label>
    <CodeInput :id="id" v-model="code" placeholder="123 456" :disabled="disabled" />
    <p class="text-muted-foreground text-xs">{{ codeDigits(code).length === 6 ? "Ready: " + codeDigits(code) : "Six digits" }}</p>
  </div>
</template>
