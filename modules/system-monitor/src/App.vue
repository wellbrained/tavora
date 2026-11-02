<script setup lang="ts">
// System Monitor: how busy this PC is and how its connection is doing. The panel has two sections, System and
// Connection; either can be hidden. Tavora's system-info connector reads the PC and pauses while the panel is hidden,
// so the module has no timers. The settings (what shows, which drives, the connection) open from the gear in the
// footer as a dialog (panel.openDialog): the same page, big, showing Settings instead of the panel.
import { Settings as SettingsIcon } from "@lucide/vue";
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import ConnectionSection from "./ConnectionSection.vue";
import AppsDialog from "./AppsDialog.vue";
import { memory, num } from "./format";
import { language, setLanguage, t } from "./i18n";
import { de, en } from "./locales";
import { createMonitor, type Monitor } from "./monitor";
import Settings from "./Settings.vue";
import SystemSection from "./SystemSection.vue";

const sdk = shallowRef<TavoraSDK | null>(null);
const monitor = shallowRef<Monitor | null>(null);
const connectError = ref<string | null>(null);
/** Why the settings would not open (an older Tavora, or no real press), told in the footer. */
const openError = ref<string | null>(null);
/** The panel is shown big as a dialog, with its settings. */
const dialogOpen = ref(false);
const showingApps = ref(false);
const stopFollowing: (() => void)[] = [];

onMounted(async () => {
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    const connected = connection.sdk;
    // The components read the module's own translator; it follows the language the handle reports.
    setLanguage(connection.language);
    stopFollowing.push(connection.onLanguage(setLanguage), connection.dispose);
    const started = createMonitor(connected);
    sdk.value = connected;
    monitor.value = started;
    connected.lifecycle.onResume(() => void started.retry());
    stopFollowing.push(connected.panel.onDialogChange((open) => (dialogOpen.value = open)));
    addEventListener("keydown", onKey);
    stopFollowing.push(() => removeEventListener("keydown", onKey));
    await started.start();
  } catch (reason) {
    connectError.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  stopFollowing.forEach((fn) => fn());
  monitor.value?.stop();
});

const status = computed(() => monitor.value?.status.value ?? "loading");
const snapshot = computed(() => monitor.value?.snapshot.value ?? null);
const tavora = computed(() => {
  const now = snapshot.value?.tavora;
  return now ? t("tavora", { cpu: num(now.cpu, 1, language.value), memory: memory(now.memoryBytes, language.value) }) : "";
});

/** Opens the settings: the panel shows them big, in a dialog over the app, as every module's settings. */
function openSettings(): void {
  openError.value = null;
  void sdk.value?.panel.openDialog({ width: 960, height: 680 }).catch((reason) => (openError.value = errorMessage(reason)));
}

function onKey(event: KeyboardEvent): void {
  // Esc in an open list (a Select, say) closes only that.
  const inPopup = (event.target as Element | null)?.closest?.("[role=listbox], [role=menu], [role=dialog]");
  if (event.key === "Escape" && dialogOpen.value && !event.defaultPrevented && !inPopup) void sdk.value?.panel.closeDialog();
}

const sections = computed(() => monitor.value?.panel.value.sections ?? { system: true, connection: true });
const bothSections = computed(() => sections.value.system && sections.value.connection);
</script>

<template>
  <Settings v-if="monitor && dialogOpen && status === 'ready'" :monitor="monitor" />
  <p v-else-if="!monitor || status === 'loading'" class="text-muted-foreground p-4 text-sm" :role="connectError ? 'alert' : 'status'" data-testid="status">
    {{ connectError ? t("connectError", { error: connectError }) : t("loading") }}
  </p>
  <div v-else class="bg-background flex size-full flex-col overflow-hidden text-sm" data-testid="system-monitor-panel">
    <p v-if="status === 'denied'" class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center" data-testid="denied">{{ t("denied") }}</p>
    <p v-else-if="status === 'empty'" class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center" data-testid="empty">{{ t("empty") }}</p>
    <p v-else-if="status === 'error'" class="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center" role="alert" data-testid="read-error">
      {{ t("readError", { error: monitor.error.value }) }}
    </p>
    <div v-else class="@container min-h-0 flex-1 overflow-y-auto">
      <h2 v-if="bothSections" class="text-muted-foreground px-3 pt-2 text-[0.6875rem] font-medium tracking-wide uppercase" data-testid="heading-system">{{ t("section.system") }}</h2>
      <SystemSection v-if="sections.system" :monitor="monitor" @show-apps="showingApps = true" />
      <h2 v-if="bothSections" class="text-muted-foreground px-3 pt-1 text-[0.6875rem] font-medium tracking-wide uppercase" data-testid="heading-connection">{{ t("section.connection") }}</h2>
      <ConnectionSection v-if="sections.connection" :monitor="monitor" />
      <p v-if="!snapshot" class="text-muted-foreground px-3 py-2 text-xs" data-testid="waiting">{{ t("waiting") }}</p>
    </div>

    <footer v-if="status === 'ready'" class="flex flex-none items-center gap-2 border-t py-1 pr-1 pl-3">
      <span v-if="openError" class="text-destructive min-w-0 flex-1 truncate text-xs" role="alert" :title="openError" data-testid="settings-error">{{ t("settings.openError", { error: openError }) }}</span>
      <span v-else class="text-muted-foreground min-w-0 flex-1 truncate text-xs tabular-nums" data-testid="tavora-use">{{ tavora }}</span>
      <Button variant="ghost" size="icon-xs" :title="t('settings.title')" :aria-label="t('settings.title')" data-testid="settings" @click="openSettings">
        <SettingsIcon :stroke-width="1.75" />
      </Button>
    </footer>

    <AppsDialog v-if="showingApps && sdk" :sdk="sdk" :total-bytes="monitor.info.value?.ramBytes ?? 0" @close="showingApps = false" />
  </div>
</template>
