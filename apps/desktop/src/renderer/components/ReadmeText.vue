<script setup lang="ts">
// The words of one readme line, with their marks. Only ever shown as text; a link is a button that asks
// the host to open it, and only when `links` is on (the catalog page; the Publish preview shows them as text).
import { TextLink } from "@tavora/official-ui/components/ui/text-link";
import type { ReadmeSpan } from "../../shared/host-api";

defineProps<{ spans: ReadmeSpan[]; links?: boolean }>();
const emit = defineEmits<{ link: [url: string] }>();
</script>

<template>
  <template v-for="(span, index) in spans" :key="index">
    <TextLink v-if="span.url && links" wrap class="text-primary"
      :class="{ 'font-semibold': span.bold, italic: span.italic, 'font-mono text-xs': span.code }" :title="span.url" @click="emit('link', span.url)"
    >{{ span.text }}</TextLink>
    <span v-else-if="span.url" class="text-primary underline underline-offset-2" :class="{ 'font-semibold': span.bold, italic: span.italic, 'font-mono text-xs': span.code }">{{ span.text }}</span>
    <code v-else-if="span.code" class="bg-muted rounded px-1 py-0.5 font-mono text-xs" :class="{ 'font-semibold': span.bold, italic: span.italic }">{{ span.text }}</code>
    <strong v-else-if="span.bold" class="font-semibold" :class="{ italic: span.italic }">{{ span.text }}</strong>
    <em v-else-if="span.italic">{{ span.text }}</em>
    <template v-else>{{ span.text }}</template>
  </template>
</template>
