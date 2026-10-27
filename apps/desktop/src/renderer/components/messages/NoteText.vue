<script setup lang="ts">
// A note's text: paragraphs with *emphasis* as the one mark-up. Shown as plain text pieces, never as markup.
import type { NoteParagraphs } from "../../../shared/conversations";

defineProps<{ paragraphs: NoteParagraphs }>();
</script>

<template>
  <p v-for="(paragraph, index) in paragraphs" :key="index">
    <template v-for="(span, at) in paragraph" :key="at"><em v-if="span.em" class="text-foreground font-medium not-italic">{{ span.text }}</em><template v-else>{{ span.text }}</template></template>
  </p>
</template>
