<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const notes = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-notes">Notes</Label>
    <Textarea id="pg-notes" v-model="notes" placeholder="Details, links, anything else" :disabled="off" />
  </div>
</template>
