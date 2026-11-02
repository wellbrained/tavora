<script setup lang="ts">
// Every theme token with the class that uses it and the value it has now. Tavora sets the tokens on <html>, so they
// are read again whenever that changes (a new theme).
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

// Each token with the Tailwind class you write for it.
const GROUPS: { title: TextKey; tokens: [token: string, tailwind: string][] }[] = [
  {
    title: "demo.colours.surfaces",
    tokens: [
      ["background", "bg-background"],
      ["card", "bg-card"],
      ["popover", "bg-popover"],
      ["rail", "bg-rail"],
      ["toast", "bg-toast"],
    ],
  },
  {
    title: "demo.colours.text",
    tokens: [
      ["foreground", "text-foreground"],
      ["card-foreground", "text-card-foreground"],
      ["popover-foreground", "text-popover-foreground"],
      ["toast-foreground", "text-toast-foreground"],
    ],
  },
  {
    title: "demo.colours.brand",
    tokens: [
      ["primary", "text-primary"],
      ["primary-hover", "hover:bg-primary-hover"],
      ["primary-foreground", "text-primary-foreground"],
      ["primary-fill", "bg-primary-fill"],
      ["primary-fill-hover", "hover:bg-primary-fill-hover"],
      ["primary-fill-foreground", "text-primary-fill-foreground"],
    ],
  },
  {
    title: "demo.colours.quiet",
    tokens: [
      ["secondary", "bg-secondary"],
      ["secondary-foreground", "text-secondary-foreground"],
      ["muted", "bg-muted"],
      ["muted-foreground", "text-muted-foreground"],
      ["accent", "bg-accent"],
      ["accent-foreground", "text-accent-foreground"],
    ],
  },
  {
    title: "demo.colours.lines",
    tokens: [
      ["border", "border-border"],
      ["input", "border-input"],
      ["ring", "ring-ring"],
    ],
  },
  {
    title: "demo.colours.status",
    tokens: [
      ["destructive", "text-destructive"],
      ["success", "text-success"],
      ["warning", "text-warning"],
      ["info", "text-info"],
    ],
  },
];

const values = ref<Record<string, string>>({});
function read() {
  const style = getComputedStyle(document.documentElement);
  values.value = Object.fromEntries(GROUPS.flatMap((group) => group.tokens.map(([token]) => [token, style.getPropertyValue(`--${token}`).trim()])));
}
const watcher = new MutationObserver(() => requestAnimationFrame(read));
onMounted(() => {
  read();
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
});
onBeforeUnmount(() => watcher.disconnect());
</script>

<template>
  <div class="flex flex-col gap-4">
    <section v-for="group in GROUPS" :key="group.title" class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium">{{ t(group.title) }}</h3>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-2">
        <div v-for="[token, tailwind] in group.tokens" :key="token" class="flex items-center gap-2 rounded-md border p-1.5" :data-token="token">
          <span class="size-8 flex-none rounded-sm border" :style="{ background: `var(--${token})` }" />
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-xs font-medium">{{ token }}</span>
            <span class="text-muted-foreground truncate font-mono text-xs">{{ tailwind }}</span>
            <span class="text-muted-foreground truncate font-mono text-xs">{{ values[token] }}</span>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>
