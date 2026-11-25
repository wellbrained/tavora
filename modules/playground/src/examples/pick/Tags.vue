<script setup lang="ts">
import { TagInput } from "@tavora/official-ui/components/ui/tag-input";
import { ref } from "vue";

// Your own tags, with the ones you used before as suggestions. Enter or a comma adds what you typed; a pasted list adds each part.
const tags = ref(["Speedrun", "Co-op"]);
const used = ["Boss rush", "Early game", "Hardcore", "No damage", "Speedrun", "Co-op", "Solo", "Farming"];
</script>

<template>
  <TagInput v-model="tags" :suggestions="used" :max="8" :maxlength="24" placeholder="Add a tag…" aria-label="Tags" class="max-w-96" />
</template>
