<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const text = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-empty">With a placeholder</Label>
    <Input id="pg-empty" v-model="text" placeholder="Add a to-do" :disabled="off" />
  </div>
</template>
