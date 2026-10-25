<script setup lang="ts">
// Shown instead of the app when the host UI fails to load or mount (see main.ts).
import { Check, Copy, RotateCw } from "@lucide/vue";
import { ref, useTemplateRef } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { setLanguage, t } from "../i18n";

const props = defineProps<{ detail: string }>();

// The language setting comes with the app's state, which never arrived; the system's is the best guess.
setLanguage(navigator.language.toLowerCase().startsWith("de") ? "de" : "en");

const [message = "", ...stack] = props.detail.split("\n");
const details = useTemplateRef<HTMLElement>("details");
const copied = ref(false);

function reload(): void {
  location.reload();
}

// The host page may not use the clipboard API, but copying a selection works.
function copy(): void {
  const selection = getSelection();
  if (!details.value || !selection) return;
  selection.selectAllChildren(details.value);
  copied.value = document.execCommand("copy");
  selection.removeAllRanges();
}
</script>

<template>
  <div class="bg-background text-foreground flex h-full flex-col" data-testid="startup-error">
    <div class="app-drag h-[47px] shrink-0" />
    <main class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 pb-8 text-center">
      <img class="mt-8 mb-6 opacity-60 grayscale" src="/brand/emblem-240.png" alt="" width="74" height="80" draggable="false" />
      <h1 class="text-2xl font-semibold">{{ t("startupError.title") }}</h1>
      <p class="text-muted-foreground mt-2 max-w-[480px]">{{ t("startupError.description") }}</p>

      <section class="bg-card mt-8 w-full max-w-[720px] rounded-lg border text-left" :aria-label="t('startupError.details')">
        <div ref="details" class="max-h-[50vh] overflow-auto p-4 font-mono text-xs leading-relaxed select-text">
          <p class="text-destructive font-semibold break-words">{{ message }}</p>
          <pre v-if="stack.length" class="text-muted-foreground mt-2 whitespace-pre">{{ stack.join("\n") }}</pre>
        </div>
      </section>

      <div class="mt-6 flex gap-2">
        <Button data-testid="startup-error-reload" @click="reload">
          <RotateCw :stroke-width="1.5" /> {{ t("startupError.retry") }}
        </Button>
        <Button variant="outline" data-testid="startup-error-copy" @click="copy">
          <component :is="copied ? Check : Copy" :stroke-width="1.5" /> {{ copied ? t("startupError.copied") : t("startupError.copy") }}
        </Button>
      </div>
    </main>
  </div>
</template>
