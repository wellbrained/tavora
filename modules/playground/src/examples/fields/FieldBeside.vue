<script setup lang="ts">
// orientation="horizontal" puts a short control beside the label. Make the panel narrow: the control moves under the
// label instead of squeezing it, and the error stays under the control. A switch with its label is a SwitchField.
import { Field } from "@tavora/official-ui/components/ui/field";
import { Input } from "@tavora/official-ui/components/ui/input";
import { NumberField } from "@tavora/official-ui/components/ui/number-field";
import { computed, ref } from "vue";

const copies = ref(2);
const port = ref("7420");
const portError = computed(() => {
  const value = port.value.trim();
  const number = Number(value);
  return /^\d+$/.test(value) && number >= 1024 && number <= 65535 ? "" : "Use a number from 1024 to 65535.";
});
</script>

<template>
  <div class="flex max-w-120 flex-col gap-4">
    <Field label="Copies" hint="How many to print." orientation="horizontal">
      <NumberField v-model="copies" :min="1" :max="9" decrease-label="One less" increase-label="One more" />
    </Field>
    <Field label="Overlay port" hint="Where stream overlays are served." :error="portError" orientation="horizontal">
      <Input v-model="port" class="w-24 tabular-nums" inputmode="numeric" maxlength="5" />
    </Field>
  </div>
</template>
