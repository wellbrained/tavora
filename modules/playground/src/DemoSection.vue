<script setup lang="ts">
// One group of elements: a heading, a sentence on when to use them, then the
// specimens.
defineProps<{ id: string; title: string; description: string }>();
</script>

<template>
  <section :id="id" :aria-labelledby="`${id}-title`" class="border-b px-4 py-6 last:border-b-0" :data-testid="`section-${id}`">
    <h2 :id="`${id}-title`" class="text-lg font-semibold">{{ title }}</h2>
    <p class="text-muted-foreground mt-1 text-sm">{{ description }}</p>
    <div class="mt-4 flex flex-col gap-5">
      <slot />
    </div>
  </section>
</template>
