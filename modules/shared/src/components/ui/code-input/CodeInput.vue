<script setup lang="ts">
// A short number code someone was sent, like a sign-in code. Room for a pasted "123 456" or
// "123-456"; read the code with codeDigits(). The browser may fill it from a message (one-time-code).
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { Input } from "../input"

const props = withDefaults(defineProps<{ length?: number; class?: HTMLAttributes["class"] }>(), { length: 6 })
const model = defineModel<string>({ default: "" })
</script>

<template>
  <Input
    v-model="model"
    :class="cn('w-40 tracking-widest tabular-nums', props.class)"
    inputmode="numeric"
    autocomplete="one-time-code"
    :maxlength="props.length + 1"
  />
</template>
