<script setup lang="ts">
// UI Playground: every control the official modules share, shown on its own
// so the look and feel can be tried out and compared. The specimens live in
// groups/ (one file per tab); this file is the shell: filter, tabs and theme
// tokens. Nothing is saved except this panel's filter, tab and the "Show
// disabled" switch, which turns every control into its disabled state.
import { Search } from "@lucide/vue";
import { connectModule } from "@tavora/official-ui";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Toaster } from "@tavora/official-ui/components/ui/toast";
import { Tabs, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { THEME_TOKENS, type TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import ActionsGroup from "./groups/ActionsGroup.vue";
import BasicsGroup from "./groups/BasicsGroup.vue";
import CanvasGroup from "./groups/CanvasGroup.vue";
import DisplayGroup from "./groups/DisplayGroup.vue";
import InputsGroup from "./groups/InputsGroup.vue";
import { GROUPS, SECTIONS, type GroupId, type SectionId } from "./sections";

interface PanelState {
  filter: string;
  disabled: boolean;
  group: GroupId;
}

const sdk = shallowRef<TavoraSDK | null>(null);
const panel = ref<PanelState>({ filter: "", disabled: false, group: "basics" });
const tokens = ref<Record<string, string>>({});
const cleanup: (() => void)[] = [];

const query = computed(() => panel.value.filter.trim().toLowerCase());
/** With a filter, matching sections show from every tab; without one, the tab's own sections. */
const visible = computed(() => {
  const ids = new Set<SectionId>();
  for (const section of SECTIONS) {
    const matches = query.value ? `${section.title} ${section.keywords}`.toLowerCase().includes(query.value) : section.group === panel.value.group;
    if (matches) ids.add(section.id);
  }
  return ids;
});
const off = computed(() => panel.value.disabled);

function readTokens() {
  const style = getComputedStyle(document.documentElement);
  tokens.value = Object.fromEntries([...THEME_TOKENS, "radius"].map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}

onMounted(async () => {
  readTokens();
  // The page also works outside Tavora (for example opened from dist/ in a
  // browser); it then keeps the default theme.
  try {
    const module = await connectModule({});
    const connected = module.sdk;
    if (!connected) throw module.error;
    readTokens();
    cleanup.push(connected.ui.onThemeChange(() => requestAnimationFrame(readTokens)));
    const state = await connected.panel.getState<Partial<PanelState>>();
    panel.value = {
      filter: typeof state?.filter === "string" ? state.filter : "",
      disabled: state?.disabled === true,
      group: GROUPS.some((group) => group.id === state?.group) ? (state!.group as GroupId) : "basics",
    };
    sdk.value = connected;
  } catch {
    // Not inside Tavora.
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));

function setPanel(patch: Partial<PanelState>) {
  panel.value = { ...panel.value, ...patch };
  void sdk.value?.panel.setState({ filter: panel.value.filter, disabled: panel.value.disabled, group: panel.value.group });
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="playground-app">
    <header class="flex h-10 flex-none items-center gap-2 border-b px-2">
      <div class="relative min-w-0 flex-1">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" :stroke-width="1.5" />
        <input
          type="search"
          class="placeholder:text-muted-foreground h-7 w-full rounded-md bg-transparent pr-2 pl-8 text-sm outline-none"
          placeholder="Filter elements"
          aria-label="Filter elements"
          data-testid="filter"
          :value="panel.filter"
          @input="setPanel({ filter: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <Label class="text-muted-foreground flex-none px-1 text-xs font-normal">
        <Switch :model-value="panel.disabled" data-testid="disable-all" @update:model-value="setPanel({ disabled: $event })" />
        Show disabled
      </Label>
    </header>

    <Tabs v-if="!query" :model-value="panel.group" class="flex-none border-b px-2" @update:model-value="setPanel({ group: $event as GroupId })">
      <TabsList class="h-9 w-full overflow-x-auto border-b-0" aria-label="Element groups">
        <TabsTrigger v-for="group in GROUPS" :key="group.id" :value="group.id" :data-testid="`tab-${group.id}`">{{ group.title }}</TabsTrigger>
      </TabsList>
    </Tabs>

    <main class="min-h-0 flex-1 overflow-y-auto" data-testid="playground-main">
      <p v-if="!visible.size" class="text-muted-foreground px-4 py-10 text-center text-sm" data-testid="no-match">
        Nothing matches “{{ panel.filter }}”.
      </p>
      <BasicsGroup :visible="visible" :off="off" :tokens="tokens" />
      <ActionsGroup :visible="visible" :off="off" />
      <InputsGroup :visible="visible" :off="off" />
      <DisplayGroup :visible="visible" :off="off" />
      <CanvasGroup :visible="visible" :off="off" />
    </main>
    <Toaster />
  </div>
</template>
