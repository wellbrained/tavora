<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { ref } from "vue";

const showFinished = ref(true);
const startOnHome = ref(false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label><Switch v-model="showFinished" /> Show finished to-dos</Label>
    <Label><Switch v-model="startOnHome" /> Start on Home</Label>
  </div>
</template>
