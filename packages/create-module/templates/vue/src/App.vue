<script setup lang="ts">
// This page runs inside a Tavora panel; in a normal browser the connection fails. Build it and add this
// folder in Tavora (Settings > Developer > Project folders > Add folder) to see it.
import type { TavoraSDK } from "@tavora/sdk";
import { bootstrapModule, languageOf, type ModuleBootstrap } from "@tavora/sdk/bootstrap";
import { computed, onMounted, onUnmounted, ref, shallowRef, watchEffect } from "vue";
import { text, type Language } from "./texts";

const language = ref<Language>(languageOf(navigator.language));
watchEffect(() => (document.documentElement.lang = language.value));

const title = document.title;
const tavora = shallowRef<TavoraSDK | null>(null);
const workspace = ref("");
const count = ref(0);
const failed = ref(false);
const status = computed(() =>
  failed.value ? text(language.value, "notConnected") : tavora.value ? text(language.value, "status", { workspace: workspace.value, count: count.value }) : text(language.value, "connecting"),
);

let boot: ModuleBootstrap | undefined;
let unmounted = false;
onUnmounted(() => {
  unmounted = true;
  boot?.dispose();
});

onMounted(async () => {
  try {
    // Connects, applies Tavora's theme as CSS variables (--background, --foreground, --primary, ...) and keeps
    // following it, so the module looks like Tavora.
    const started = await bootstrapModule();
    // Taken down while it connected: let go of it.
    if (unmounted) return started.dispose();
    boot = started;
    const sdk = boot.sdk;
    if (!sdk) throw boot.error;
    language.value = languageOf(boot.language);
    boot.onLanguage((code) => (language.value = languageOf(code)));
    workspace.value = (await sdk.workspace.getCurrent()).displayName;
    // storage keeps small settings for this module in the current workspace.
    count.value = (await sdk.storage.get<number>("count")) ?? 0;
    tavora.value = sdk;
  } catch (error) {
    console.error("Not connected to Tavora", error);
    failed.value = true;
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
    <!-- rules-allow: kit-control Tavora's kit isn't on npm yet; Tavora styles a plain button like its own -->
    <button type="button" :disabled="!tavora" @click="add">{{ text(language, "add") }}</button>
  </main>
</template>
