<script setup lang="ts">
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <StarRating :model-value="3.5" size="sm" label="3.5 out of 5 stars" />
    <StarRating :model-value="3.5" label="3.5 out of 5 stars" />
    <StarRating :model-value="3.5" size="lg" label="3.5 out of 5 stars" />
  </div>
</template>
