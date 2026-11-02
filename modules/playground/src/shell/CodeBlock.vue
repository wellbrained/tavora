<script setup lang="ts">
// An example's source: its file name and a copy button on top, then the code in the theme's mono font, coloured by
// highlight.ts with the theme's own colours (so dark and light both read well), with line numbers in a muted column
// that can't be selected and a thin line between it and the code. Copy copies the plain source, without the numbers.
// The code scrolls on its own and can be reached with Tab, so it scrolls by keyboard too.
import { Check, Copy } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { toast } from "@tavora/official-ui/components/ui/toast";
import { computed, onBeforeUnmount, ref } from "vue";
import { t } from "../i18n";
import { lineCount, tokenize, type TokenKind } from "./highlight";

const props = defineProps<{ code: string; file: string; label: string }>();

// Every colour is a theme token or a mix of two, so a theme with other colours brings its own code colours.
const COLOURS: Record<TokenKind, string> = {
  plain: "text-foreground",
  keyword: "text-[color-mix(in_srgb,var(--primary)_78%,var(--foreground))]",
  string: "text-[color-mix(in_srgb,var(--success)_75%,var(--foreground))]",
  number: "text-[color-mix(in_srgb,var(--destructive)_65%,var(--warning))]",
  comment: "text-muted-foreground",
  punct: "text-[color-mix(in_srgb,var(--foreground)_62%,var(--background))]",
  delim: "text-[color-mix(in_srgb,var(--primary)_78%,var(--foreground))]",
  tag: "text-[color-mix(in_srgb,var(--info)_80%,var(--foreground))]",
  component: "text-[color-mix(in_srgb,var(--info)_50%,var(--destructive))]",
  attr: "text-[color-mix(in_srgb,var(--primary)_45%,var(--foreground))]",
};

const tokens = computed(() => tokenize(props.code));
const numbers = computed(() => Array.from({ length: lineCount(props.code) }, (_, index) => index + 1));

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
    <!-- One scroll area for both columns, so the numbers keep step with the lines. The numbers stay in view when the code scrolls sideways. -->
    <div class="max-h-120 overflow-auto font-mono text-xs leading-5 [scrollbar-width:thin]" tabindex="0" role="region" :aria-label="label" data-testid="example-scroll">
      <div class="flex min-w-max pb-4">
        <div class="bg-[color-mix(in_srgb,var(--muted)_40%,var(--background))] text-muted-foreground sticky left-0 flex flex-none flex-col border-r py-0 pr-3 pl-4 text-right tabular-nums select-none" aria-hidden="true" data-testid="line-numbers">
          <span v-for="number in numbers" :key="number">{{ number }}</span>
        </div>
        <pre class="px-4" data-testid="example-code"><code><span v-for="(token, index) in tokens" :key="index" :class="COLOURS[token.kind]" :data-kind="token.kind">{{ token.text }}</span></code></pre>
      </div>
    </div>
  </div>
</template>
