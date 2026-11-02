<script setup lang="ts">
// An example's source: its file name and a copy button on top, then the code in the theme's mono font. The code
// scrolls on its own and can be reached with Tab, so it scrolls by keyboard too.
import { Check, Copy } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { onBeforeUnmount, ref } from "vue";
import { t } from "../i18n";

const props = defineProps<{ code: string; file: string; label: string }>();

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  try {
    await navigator.clipboard.writeText(props.code);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied.value = false), 1500);
    toast({ title: t("box.copied") });
  } catch {
    toast.error(t("box.copyFailed"));
  }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="bg-muted/40 flex flex-col">
    <div class="flex items-center gap-2 py-1.5 pr-2 pl-4">
      <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{{ file }}</span>
      <Button variant="ghost" size="xs" data-testid="copy-code" @click="copy">
        <Check v-if="copied" class="text-success" :stroke-width="1.75" />
        <Copy v-else :stroke-width="1.5" />
        {{ t("box.copy") }}
      </Button>
    </div>
    <pre class="max-h-120 overflow-auto px-4 pb-4 font-mono text-xs leading-5 [scrollbar-width:thin]" tabindex="0" :aria-label="label" data-testid="example-code"><code>{{ code }}</code></pre>
  </div>
</template>
