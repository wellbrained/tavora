<script setup lang="ts">
// A module's description on its page: its readme sorted into the template's sections (Overview, Features,
// How to use, Settings, Requirements, Known issues, then More), always in that order with the same look,
// whatever order the author wrote them in. Every text is plain text (C10), shown by text interpolation
// only. A link opens through the host, which checks the address against the module's current readme.
import { computed, ref, type Component } from "vue";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import { BookOpen, Bug, Ellipsis, ListChecks, SlidersHorizontal, Sparkles } from "@lucide/vue";
import type { ReadmeBlock } from "../../shared/host-api";
import { sortReadme, type ReadmeSectionId } from "../../shared/readme-sections";
import { act, dialog } from "../host";
import { t } from "../i18n";
import ReadmeText from "./ReadmeText.vue";

const props = withDefaults(
  defineProps<{
    blocks: ReadmeBlock[];
    /** Shown instead when there is no readme. */
    fallback?: string | null;
    /** The catalog module the readme belongs to; links are clickable only with it. */
    moduleId?: string;
    /** Show the "Description" title (the Publish preview has its own). */
    heading?: boolean;
  }>(),
  { fallback: null, moduleId: undefined, heading: true },
);

const ICONS: Record<Exclude<ReadmeSectionId, "overview"> | "more", Component> = {
  features: Sparkles,
  usage: BookOpen,
  settings: SlidersHorizontal,
  requirements: ListChecks,
  issues: Bug,
  more: Ellipsis,
};

const sections = computed(() => {
  const sorted = sortReadme(props.blocks);
  const list: { id: ReadmeSectionId | "more"; blocks: ReadmeBlock[] }[] = sorted.known.map((section) => ({ id: section.id, blocks: section.blocks }));
  if (sorted.more.length) {
    list.push({
      id: "more",
      blocks: sorted.more.flatMap((section) => [{ kind: "heading", level: 3, text: section.title } satisfies ReadmeBlock, ...section.blocks]),
    });
  }
  return list;
});

const error = ref<string | null>(null);
async function openLink(url: string) {
  if (!props.moduleId) return;
  error.value = null;
  const library = dialog.value;
  const outcome = await act({ type: "open-readme-link", moduleId: props.moduleId, url }, { quiet: true });
  if (!outcome.ok) error.value = outcome.error;
  // Opened in a Browser panel: close the library so the user sees it, as the homepage button does.
  else if (dialog.value === library) dialog.value = null;
}
</script>

<template>
  <section data-testid="catalog-info-about">
    <h3 v-if="heading" class="mb-2 font-medium">{{ t("catalog.about") }}</h3>
    <Expandable v-if="sections.length" :max-height="240">
      <div class="space-y-5 text-sm leading-relaxed" data-testid="catalog-info-readme">
        <section v-for="section in sections" :key="section.id" :data-testid="`catalog-info-section-${section.id}`">
          <h4 v-if="section.id !== 'overview'" class="mb-2 flex items-center gap-2 text-base font-semibold">
            <component :is="ICONS[section.id]" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
            {{ t(`catalog.section.${section.id}`) }}
          </h4>
          <div class="space-y-3">
            <template v-for="(block, index) in section.blocks" :key="index">
              <h5 v-if="block.kind === 'heading'" class="pt-1 font-medium">{{ block.text }}</h5>
              <p v-else-if="block.kind === 'paragraph'"><ReadmeText :spans="block.spans" :links="!!moduleId" @link="openLink" /></p>
              <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'" :class="block.ordered ? 'list-decimal' : 'list-disc'" class="space-y-1 pl-5">
                <li v-for="(item, at) in block.items" :key="at">
                  <ReadmeText :spans="item.spans" :links="!!moduleId" @link="openLink" />
                  <ul v-if="item.children" class="mt-1 list-[circle] space-y-1 pl-5">
                    <li v-for="(child, childAt) in item.children" :key="childAt"><ReadmeText :spans="child" :links="!!moduleId" @link="openLink" /></li>
                  </ul>
                </li>
              </component>
              <pre v-else class="bg-muted/50 overflow-x-auto rounded-md p-3 text-xs">{{ block.text }}</pre>
            </template>
          </div>
        </section>
      </div>
    </Expandable>
    <p v-else-if="fallback" class="text-sm">{{ fallback }}</p>
    <p v-if="error" class="text-destructive mt-2 text-sm" role="alert">{{ error }}</p>
    <slot />
  </section>
</template>
