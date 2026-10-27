<script setup lang="ts">
// This page runs inside a Tavora panel; in a normal browser connect() fails. Build it and add this
// folder in Tavora (Settings > Development > Add a development folder) to see it.
import { connect, type TavoraSDK, type TavoraTheme } from "@tavora/sdk";
import { computed, onMounted, ref, shallowRef } from "vue";

/** Your texts in English and German; Tavora says which language the player uses. */
const TEXTS = {
  en: { connecting: "Connecting to Tavora…", here: "You're in {workspace}.", clicked: "Clicked {count} times here." },
  de: { connecting: "Verbinde mit Tavora …", here: "Du bist in {workspace}.", clicked: "{count}-mal hier geklickt." },
};
const language = ref<keyof typeof TEXTS>("en");
const text = (key: keyof (typeof TEXTS)["en"], params: Record<string, string | number> = {}) =>
  TEXTS[language.value][key].replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));

const title = document.title;
const tavora = shallowRef<TavoraSDK | null>(null);
const workspace = ref("");
const count = ref(0);
const failed = ref<string | null>(null);
const status = computed(() => (failed.value ? failed.value : tavora.value ? `${text("here", { workspace: workspace.value })} ${text("clicked", { count: count.value })}` : text("connecting")));

/** Tavora's theme as CSS variables (--background, --foreground, --primary, ...), so the module looks like Tavora. */
function applyTheme(theme: TavoraTheme) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("--radius", `${theme.radius}px`);
  root.style.colorScheme = theme.mode;
}

onMounted(async () => {
  try {
    const sdk = await connect();
    applyTheme(await sdk.ui.getTheme());
    sdk.ui.onThemeChange(applyTheme);
    const setLanguage = (code: string) => (language.value = code.startsWith("de") ? "de" : "en");
    setLanguage(await sdk.ui.getLanguage());
    sdk.ui.onLanguageChange(setLanguage);
    workspace.value = (await sdk.workspace.getCurrent()).displayName;
    // storage keeps small settings for this module in the current workspace.
    count.value = (await sdk.storage.get<number>("count")) ?? 0;
    tavora.value = sdk;
  } catch (error) {
    failed.value = `Not connected to Tavora: ${error instanceof Error ? error.message : String(error)}`;
  }
});

async function add() {
  count.value += 1;
  await tavora.value?.storage.set("count", count.value);
}
</script>

<template>
  <main>
    <h1>{{ title }}</h1>
    <p id="status">{{ status }}</p>
    <button type="button" :disabled="!tavora" @click="add">+1</button>
  </main>
</template>
