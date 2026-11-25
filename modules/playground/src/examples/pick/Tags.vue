<script setup lang="ts">
import { TagInput } from "@tavora/official-ui/components/ui/tag-input";
import { ref } from "vue";

// Your own tags, with the ones you used before as suggestions. Enter or a comma adds what you typed; a pasted list adds each part.
const tags = ref(["Speedrun", "Co-op"]);
// A text size from the scale by class makes the chips bigger.
const big = ref(["Boss rush", "Solo"]);
const used = ["Boss rush", "Early game", "Hardcore", "No damage", "Speedrun", "Co-op", "Solo", "Farming"];
</script>

<template>
  <div class="flex flex-col gap-3">
    <TagInput v-model="tags" :suggestions="used" :max="8" :maxlength="24" placeholder="Add a tag…" aria-label="Tags" class="max-w-96" />
    <TagInput v-model="big" :suggestions="used" placeholder="Add a tag…" aria-label="Tags, bigger text" class="max-w-96 text-base" />
  </div>
</template>
