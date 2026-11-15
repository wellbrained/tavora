<script setup lang="ts">
// An error turns the field red, marks it invalid and is read out when it appears. Type fewer than three letters.
import { Field } from "@tavora/official-ui/components/ui/field";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { computed, ref } from "vue";

const name = ref("ab");
const nameError = computed(() => (name.value.trim().length < 3 ? "Use at least three letters." : ""));
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field label="Name" hint="Shown in the panel tab." :error="nameError">
      <Input v-model="name" />
    </Field>
    <Field label="Text area with an error" error="Write at least a sentence.">
      <Textarea model-value="Hi" />
    </Field>
  </div>
</template>
