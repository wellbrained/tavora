<script setup lang="ts">
// A titled block of settings on a page, so a long section reads as a few
// short groups. The rows inside are SettingRows, or anything else.
defineProps<{ title?: string; description?: string }>();
</script>

<template>
  <section class="flex flex-col gap-3 not-first:mt-10">
    <header v-if="title" class="flex flex-col gap-1">
      <h3 class="text-primary text-xs font-semibold tracking-wider uppercase">{{ title }}</h3>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </header>
    <div class="bg-background/40 flex flex-col rounded-xl border px-5">
      <slot />
    </div>
  </section>
</template>
