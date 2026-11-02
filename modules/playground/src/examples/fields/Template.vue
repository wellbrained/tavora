<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Label } from "@tavora/official-ui/components/ui/label";
import { TemplateInput } from "@tavora/official-ui/components/ui/template-input";
import { ref, useId, useTemplateRef } from "vue";

const id = useId();
const text = ref("Plank {time} {oops}");
const field = useTemplateRef<{ insert: (value: string) => Promise<void> }>("field");
</script>

<template>
  <div class="flex w-80 flex-col gap-1.5">
    <Label :for="id">Overlay text</Label>
    <TemplateInput :id="id" ref="field" v-model="text" :known="['time']" :maxlength="80" />
    <div class="flex gap-1">
      <Button variant="secondary" size="xs" @mousedown.prevent @click="field?.insert('{time}')">{time}</Button>
    </div>
  </div>
</template>
