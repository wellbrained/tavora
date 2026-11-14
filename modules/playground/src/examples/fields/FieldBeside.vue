<script setup lang="ts">
// orientation="horizontal" puts the control beside the label. Make the panel narrow: the control moves under the
// label instead of squeezing it.
import { Field } from "@tavora/official-ui/components/ui/field";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed, ref } from "vue";

const sounds = ref(true);
const port = ref("7420");
const portError = computed(() => (/^\d{4,5}$/.test(port.value.trim()) ? "" : "Use a number from 1024 to 65535."));
</script>

<template>
  <div class="flex max-w-120 flex-col gap-4">
    <Field label="Sounds" hint="Plays a sound for new messages." orientation="horizontal">
      <Switch v-model="sounds" />
    </Field>
    <Field label="Overlay port" hint="Where stream overlays are served." :error="portError" orientation="horizontal">
      <Input v-model="port" class="w-24 tabular-nums" inputmode="numeric" maxlength="5" />
    </Field>
  </div>
</template>
