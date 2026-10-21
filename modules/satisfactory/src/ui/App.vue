<script setup lang="ts">
// One page for both panel types: Tavora says which one this panel is
// (tavora.panel.type), and the page shows the Planner or the Codex.
import { connectModule, errorMessage } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";
import { onMounted, provide, ref, shallowRef } from "vue";
import { language, setLanguage, t } from "../i18n";
import Codex from "./codex/Codex.vue";
import Notice from "./common/Notice.vue";
import { MODULE, type ModuleContext } from "./context";
import Planner from "./planner/Planner.vue";
import { createServices } from "./services";
import { createTipDirective } from "./tooltip";

const context = shallowRef<ModuleContext | null>(null);
const panelType = ref<"planner" | "codex">("planner");
const error = ref<string | null>(null);
const notice = ref<{ id: number; message: string } | null>(null);
let noticeCount = 0;

function notify(message: string) {
  notice.value = { id: ++noticeCount, message };
}

// Provided before connecting; the panels render only once it is filled in.
const proxy: ModuleContext = {
  get sdk() {
    return context.value!.sdk;
  },
  get services() {
    return context.value!.services;
  },
  get tip() {
    return context.value!.tip;
  },
  notify,
};
provide(MODULE, proxy);

onMounted(async () => {
  try {
    const sdk: TavoraSDK = await connectModule(setLanguage);
    const services = await createServices(sdk, { language: () => language.value });
    // A panel without a type (an older Tavora) is a Planner.
    panelType.value = sdk.panel.type === "codex" ? "codex" : "planner";
    context.value = { sdk, services, notify, tip: createTipDirective(sdk) };
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});
</script>

<template>
  <p v-if="!context" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <template v-else>
    <Codex v-if="panelType === 'codex'" />
    <Planner v-else />
  </template>
  <Notice v-if="notice" :key="notice.id" :message="notice.message" @dismiss="notice = null" />
</template>
