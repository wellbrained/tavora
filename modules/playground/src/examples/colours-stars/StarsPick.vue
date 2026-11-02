<script setup lang="ts">
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const stars = ref(0);
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <StarRating v-model="stars" editable size="lg" label="Your rating" :star-label="(n) => (n === 1 ? '1 star' : `${n} stars`)" :disabled="off" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ stars ? `${stars} of 5` : "Not rated" }}</span>
  </div>
</template>
