<script setup lang="ts">
import { TagInput } from "@tavora/official-ui/components/ui/tag-input";
import { ref } from "vue";

// Only what the list offers can be picked: a filter. The large size matches a large button beside it.
const kinds = ref(["Units"]);
</script>

<template>
  <TagInput v-model="kinds" :free="false" size="lg" :suggestions="['Units', 'Spells', 'Buildings', 'Kings', 'Relics']" placeholder="Filter by kind…" aria-label="Kinds" class="max-w-96" />
</template>
