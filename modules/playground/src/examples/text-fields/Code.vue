<script setup lang="ts">
import { CodeInput, codeDigits } from "@tavora/official-ui/components/ui/code-input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const code = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-code">Code</Label>
    <CodeInput id="pg-code" v-model="code" placeholder="123 456" :disabled="off" />
    <p class="text-muted-foreground text-xs">{{ codeDigits(code).length === 6 ? "Ready: " + codeDigits(code) : "Six digits" }}</p>
  </div>
</template>
