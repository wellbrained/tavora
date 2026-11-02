<script setup lang="ts">
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <StarRating :model-value="4.7" label="4.7 out of 5 stars" />
    <StarRating :model-value="4.2" label="4.2 out of 5 stars" />
    <StarRating :model-value="4.8" label="4.8 out of 5 stars" />
  </div>
</template>
