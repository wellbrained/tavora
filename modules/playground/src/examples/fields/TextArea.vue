<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { ref, useId } from "vue";

const id = useId();
const notes = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id">Details</Label>
    <Textarea :id="id" v-model="notes" placeholder="Details, links, anything else" />
  </div>
</template>
