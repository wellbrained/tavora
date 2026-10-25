<script setup lang="ts">
// System Monitor: how busy this PC is and how its connection is doing. The panel has two sections, System and
// Connection; either can be hidden. Tavora's system-info connector reads the PC and pauses while the panel is hidden,
// so the module has no timers. One ⋯ menu holds every choice: which sections and blocks show, how often it updates,
// the graphics card, the drives, and whether and where to ping for the connection.
import { Ellipsis } from "@lucide/vue";
import { connectModule, errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import ConnectionSection from "./ConnectionSection.vue";
import DrivesDialog from "./DrivesDialog.vue";
import { memory, num } from "./format";
import { language, setLanguage, t } from "./i18n";
import { buildMenu, parsePick } from "./menu";
import { createMonitor, type Monitor } from "./monitor";
import { watchedDrives } from "./settings";
import SystemSection from "./SystemSection.vue";
import ConnectionDialog from "./ConnectionDialog.vue";

const sdk = shallowRef<TavoraSDK | null>(null);
const monitor = shallowRef<Monitor | null>(null);
const connectError = ref<string | null>(null);
const picking = ref(false);
const connecting = ref(false);

onMounted(async () => {
  try {
    const connected = await connectModule(setLanguage);
    const started = createMonitor(connected);
    sdk.value = connected;
    monitor.value = started;
    connected.lifecycle.onResume(() => void started.retry());
    await started.start();
  } catch (reason) {
    connectError.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => monitor.value?.stop());

const status = computed(() => monitor.value?.status.value ?? "loading");
const snapshot = computed(() => monitor.value?.snapshot.value ?? null);
const tavora = computed(() => {
  const now = snapshot.value?.tavora;
  return now ? t("tavora", { cpu: num(now.cpu, 1, language.value), memory: memory(now.memoryBytes, language.value) }) : "";
});

async function openMenu(event: MouseEvent): Promise<void> {
  const started = monitor.value;
  if (!started || !sdk.value) return;
  const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const picked = await sdk.value.ui.showMenu({
    items: buildMenu(t, started.info.value, started.app.value, started.panel.value, started.connectionMissing.value ? null : started.connectionSettings.value),
    at: { x: button.left, y: button.top, width: button.width, height: button.height },
    align: "end",
  });
  const pick = picked ? parsePick(picked) : null;
  if (!pick) return;
  if (pick.kind === "section") started.toggleSection(pick.id);
  else if (pick.kind === "block") started.toggleBlock(pick.id);
  else if (pick.kind === "interval") started.setInterval(pick.ms);
  else if (pick.kind === "gpu") started.setGpu(pick.id);
  else if (pick.kind === "connection") connecting.value = true;
  else picking.value = true;
}

function saveDrives(drives: string[]): void {
  picking.value = false;
  monitor.value?.setDrives(drives);
}

const sections = computed(() => monitor.value?.panel.value.sections ?? { system: true, connection: true });
const bothSections = computed(() => sections.value.system && sections.value.connection);

const checkedDrives = computed(() => (monitor.value?.info.value ? watchedDrives(monitor.value.info.value, monitor.value.app.value) : []));
</script>

<template>
  <p v-if="!monitor || status === 'loading'" class="text-muted-foreground p-4 text-sm" :role="connectError ? 'alert' : 'status'" data-testid="status">
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
      <SystemSection v-if="sections.system" :monitor="monitor" />
      <h2 v-if="bothSections" class="text-muted-foreground px-3 pt-1 text-[0.6875rem] font-medium tracking-wide uppercase" data-testid="heading-connection">{{ t("section.connection") }}</h2>
      <ConnectionSection v-if="sections.connection" :monitor="monitor" />
      <p v-if="!snapshot" class="text-muted-foreground px-3 py-2 text-xs" data-testid="waiting">{{ t("waiting") }}</p>
    </div>

    <footer v-if="status === 'ready'" class="flex flex-none items-center gap-2 border-t py-1 pr-1 pl-3">
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs tabular-nums" data-testid="tavora-use">{{ tavora }}</span>
      <Button variant="ghost" size="icon-xs" :title="t('menu.options')" :aria-label="t('menu.options')" data-testid="menu" @click="openMenu">
        <Ellipsis :stroke-width="1.75" />
      </Button>
    </footer>

    <ConnectionDialog v-if="connecting && monitor.connectionSettings.value" :current="monitor.connectionSettings.value" :save="monitor.setConnection" @done="connecting = false" @cancel="connecting = false" />
    <DrivesDialog v-if="picking && monitor.info.value" :info="monitor.info.value" :checked="checkedDrives" @save="saveDrives" @cancel="picking = false" />
  </div>
</template>
