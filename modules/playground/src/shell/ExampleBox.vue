<script setup lang="ts">
// One example on a page: its name (and a note), Show code, the live example, an optional rule from the module rules,
// and the example's own source when Show code is on. The live part sits on the panel's background, like in a module.
import { Code } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Collapsible, CollapsibleContent } from "@tavora/official-ui/components/ui/collapsible";
import { ref, useId } from "vue";
import type { Example } from "../examples";
import { t } from "../i18n";
import CodeBlock from "./CodeBlock.vue";

defineProps<{ name: string; example: Example; title: string; note?: string; rule?: string; disabled: boolean }>();

const id = useId();
const showCode = ref(false);
</script>

<template>
  <section class="bg-background overflow-hidden rounded-lg border" :aria-labelledby="`${id}-title`" :data-testid="`example-${name}`">
    <header class="flex items-start gap-3 pt-3 pr-3 pl-4">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <h2 :id="`${id}-title`" class="text-sm font-medium">{{ title }}</h2>
        <p v-if="note" class="text-muted-foreground text-xs">{{ note }}</p>
      </div>
      <Button variant="ghost" size="xs" class="text-muted-foreground flex-none" :aria-expanded="showCode" :aria-controls="`${id}-code`" data-testid="show-code" @click="showCode = !showCode">
        <Code :stroke-width="1.5" />
        {{ showCode ? t("box.hideCode") : t("box.showCode") }}
      </Button>
    </header>
    <div class="p-4" data-slot="example-body">
      <component :is="example.component" v-bind="example.takesDisabled ? { disabled } : {}" />
    </div>
    <p v-if="rule" class="text-muted-foreground flex gap-2 border-t px-4 py-2.5 text-xs" data-testid="example-rule">
      <span class="text-foreground flex-none font-medium">{{ t("box.rule") }}</span>
      <span>{{ rule }}</span>
    </p>
    <Collapsible v-model:open="showCode">
      <CollapsibleContent :id="`${id}-code`" class="border-t">
        <CodeBlock :code="example.source" :file="example.file" :label="t('box.code', { name: title })" />
      </CollapsibleContent>
    </Collapsible>
  </section>
</template>
