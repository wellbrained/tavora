<script setup lang="ts">
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const name = ref("Waystone");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-name">Name</Label>
    <Input id="pg-name" v-model="name" :disabled="off" />
    <p class="text-muted-foreground text-xs">Shown in the panel tab.</p>
  </div>
</template>
