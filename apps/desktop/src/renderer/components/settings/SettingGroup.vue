<script setup lang="ts">
// A titled block of settings on a page, so a long section reads as a few
// short groups. The rows inside are SettingRows, or anything else. A title
// that only repeats the page's own title is left out: the page already says it.
import { computed, inject } from "vue";
import { SETTINGS_PAGE_TITLE } from "./settings-page";

const props = defineProps<{ title?: string; description?: string }>();
const pageTitle = inject(SETTINGS_PAGE_TITLE, null);
const heading = computed(() => (props.title && props.title !== pageTitle?.value ? props.title : undefined));
</script>

<template>
  <section class="flex flex-col gap-3 not-first:mt-10">
    <header v-if="heading || description" class="flex flex-col gap-1">
      <h3 v-if="heading" class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{{ heading }}</h3>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </header>
    <div class="bg-background/40 flex flex-col rounded-xl border px-5">
      <slot />
    </div>
  </section>
</template>
