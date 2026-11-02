<script setup lang="ts">
// One page: a short intro, then one box per example.
import { Notice } from "@tavora/official-ui/components/ui/notice";
import ExampleBox from "./ExampleBox.vue";
import { t } from "./i18n";
import type { PageDef } from "./pages";

defineProps<{ page: PageDef }>();
</script>

<template>
  <section :id="page.id" class="flex max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6" :data-testid="`page-${page.id}`">
    <p v-if="page.intro" class="text-muted-foreground text-sm">{{ page.intro }}</p>
    <ExampleBox v-for="example in page.examples" :key="example.file" :example="example" />
    <Notice v-if="page.coming">{{ t("page.coming") }}</Notice>
  </section>
</template>
