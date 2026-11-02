<script setup lang="ts">
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const checked = ref(true);
const unchecked = ref(false);
const mixed = ref<boolean | "indeterminate">("indeterminate");
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label><Checkbox v-model="checked" :disabled="off" /> Checked</Label>
    <Label><Checkbox v-model="unchecked" :disabled="off" /> Unchecked</Label>
    <Label><Checkbox v-model="mixed" :disabled="off" /> Some of them</Label>
  </div>
</template>
