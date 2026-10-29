<script setup lang="ts">
// One page of ModuleSettings: a title and one sentence, then an optional main bar (an overlay's
// on/off switch, say) and an optional preview, which both stay in place, then the sections, which scroll.
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-label="title" data-slot="settings-page">
    <header class="flex-none px-8 pt-6">
      <h2 class="text-lg font-semibold tracking-tight">{{ title }}</h2>
      <p v-if="description" class="text-muted-foreground mt-1 text-sm">{{ description }}</p>
      <slot name="main" />
      <slot name="preview" />
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-8 pb-6 [scrollbar-width:thin]">
      <slot />
    </div>
  </section>
</template>
