<script setup lang="ts">
import { SettingsPreview } from "@tavora/official-ui/components/ui/module-settings";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ref } from "vue";

const rows = ref(3);
</script>

<template>
  <div class="flex max-w-lg flex-col items-start gap-2">
    <Button variant="secondary" size="sm" @click="rows = rows === 6 ? 2 : rows + 1">Add a row</Button>
    <SettingsPreview kind="panel" label="Preview of the panel" align="start" class="w-full">
      <ul class="bg-card text-card-foreground w-64 rounded-lg border p-3 text-sm">
        <li v-for="row in rows" :key="row">Row {{ row }}</li>
      </ul>
    </SettingsPreview>
  </div>
</template>
