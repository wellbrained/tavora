<script setup lang="ts">
// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Project folders > Add folder) to see it.
import type { TavoraSDK } from "@tavora/sdk";
import { bootstrapModule, languageOf, type ModuleBootstrap } from "@tavora/sdk/bootstrap";
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";

/** Your texts in English and German; Tavora says which language the user uses. */
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

let boot: ModuleBootstrap | undefined;
onUnmounted(() => boot?.dispose());

onMounted(async () => {
  try {
    // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
    // following it, so the module looks like Tavora.
    boot = await bootstrapModule();
    const sdk = boot.sdk;
    if (!sdk) throw boot.error;
    language.value = languageOf(boot.language);
    boot.onLanguage((code) => (language.value = languageOf(code)));
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
