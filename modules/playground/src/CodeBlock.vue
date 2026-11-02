<script setup lang="ts">
// An example's source in the theme's mono font, with a button that copies it.
import { Copy } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { t } from "./i18n";

const props = defineProps<{ code: string }>();

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code);
    toast({ title: t("example.copied") });
  } catch {
    toast.error(t("example.copyError"));
  }
}
</script>

<template>
  <div class="bg-muted/40 relative rounded-b-lg border-t" data-testid="example-code">
    <pre class="overflow-x-auto p-4 pr-12 font-mono text-xs leading-5" tabindex="0" :aria-label="t('example.code')"><code>{{ code }}</code></pre>
    <Button class="absolute top-2 right-2" size="icon-xs" variant="secondary" :aria-label="t('example.copy')" :title="t('example.copy')" data-testid="copy-code" @click="copy">
      <Copy :stroke-width="1.5" />
    </Button>
  </div>
</template>
