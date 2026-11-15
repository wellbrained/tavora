<script setup lang="ts">
// Field wires the label, the hint and the input together: a click on the label reaches the input, and a screen reader
// reads the hint with it.
import { Field } from "@tavora/official-ui/components/ui/field";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref } from "vue";

const name = ref("Waystone");
const text = ref("");
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field label="Name" hint="Shown in the panel tab.">
      <Input v-model="name" />
    </Field>
    <Field label="With a placeholder">
      <Input v-model="text" placeholder="Add a to-do" />
    </Field>
  </div>
</template>
