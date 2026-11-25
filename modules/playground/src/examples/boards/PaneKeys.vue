<script setup lang="ts">
// Keys for this pane only: click into it (or nothing on the page has the focus) and type letters. They stop in the
// field, in a menu or dialog, and with Ctrl or Alt held. Escape clears.
import { usePaneKeys } from "@tavora/official-ui";
import { Input } from "@tavora/official-ui/components/ui/input";
import { computed, ref, useTemplateRef } from "vue";
import { t } from "../../i18n";

const fieldLabel = computed(() => t("demo.paneField"));

const pane = useTemplateRef<HTMLElement>("pane");
const typed = ref("");

usePaneKeys(pane, (event) => {
  if (event.key === "Escape") typed.value = "";
  else if (event.key === "Backspace") typed.value = typed.value.slice(0, -1);
  else if (/^[a-z]$/i.test(event.key)) typed.value = (typed.value + event.key.toUpperCase()).slice(-12);
  else return false;
  return true;
});
</script>

<template>
  <section ref="pane" class="flex max-w-72 flex-col gap-3 rounded-lg border p-3">
    <p class="bg-muted/40 min-h-10 rounded-md px-3 py-2 font-mono text-lg tracking-widest" aria-live="polite">{{ typed || "·" }}</p>
    <Input :placeholder="fieldLabel" :aria-label="fieldLabel" />
  </section>
</template>
