<script setup lang="ts">
// One example on a page: its name and a Show code button, the example itself, an optional rule and, when asked
// for, its code.
import { Code } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed, ref, useId } from "vue";
import CodeBlock from "./CodeBlock.vue";
import { loadExample } from "./examples";
import { t } from "./i18n";
import { exampleCode, type ExampleDef } from "./pages";

const props = defineProps<{ example: ExampleDef }>();

const loaded = computed(() => loadExample(props.example.file));
const code = computed(() => (loaded.value ? exampleCode(loaded.value.source) : ""));
const open = ref(false);
const id = useId();
const slug = computed(() => props.example.file.replace("/", "-"));
</script>

<template>
  <section class="bg-card rounded-lg border" :aria-labelledby="`${id}-title`" :data-testid="`example-${slug}`">
    <header class="flex min-h-10 items-center gap-3 border-b py-1.5 pr-2 pl-4">
      <h3 :id="`${id}-title`" class="min-w-0 flex-1 text-sm font-medium">{{ example.title }}</h3>
      <Button variant="ghost" size="xs" class="flex-none" :aria-expanded="open" :aria-controls="`${id}-code`" data-testid="show-code" @click="open = !open">
        <Code :stroke-width="1.5" />
        {{ open ? t("example.hide") : t("example.show") }}
      </Button>
    </header>
    <div class="overflow-x-auto p-4" data-testid="example-live">
      <component :is="loaded.component" v-if="loaded" />
    </div>
    <p v-if="example.rules" class="text-muted-foreground flex gap-2 border-t px-4 py-2.5 text-xs" data-testid="example-rules">
      <span class="text-foreground flex-none font-medium">{{ t("example.rules") }}</span>
      <span>{{ example.rules }}</span>
    </p>
    <CodeBlock v-if="open" :id="`${id}-code`" :code="code" />
  </section>
</template>
