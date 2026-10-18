<script setup lang="ts">
// The Catalog view of the module library: modules from Tavora's catalog for this game or personal
// workspace, as cards like the installed ones. The main process fetches and checks the list and does the install (catalog-client.ts);
// every text here is shown as plain text, and "by <name>" is only the developer name the service gave.
import { computed, onMounted, ref, watch } from "vue";
import type { CatalogListResult, CatalogModuleView } from "../../shared/host-api";
import { act, addModule, api, dialog, openSettings, state, type AddModuleRequest } from "../host";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import { ShieldCheck } from "@lucide/vue";

const props = defineProps<{ query: string }>();
/** How many modules are listed for the search, or null while there is no list. */
const emit = defineEmits<{ count: [number | null] }>();

const result = ref<CatalogListResult | null>(null);
const installing = ref<string | null>(null);
const errors = ref<Record<string, string>>({});

async function load() {
  result.value = null;
  result.value = await api.browseCatalog();
}
onMounted(load);

const installed = computed(() => new Set(state.value!.modules.map((module) => module.id)));
const shown = computed(() => {
  if (result.value?.status !== "ok") return [];
  const text = props.query.trim().toLocaleLowerCase();
  return result.value.modules.filter((module) => !text || [module.name, module.description ?? "", module.id, module.publisher ?? ""].some((value) => value.toLocaleLowerCase().includes(text)));
});

watch(
  () => (result.value?.status === "ok" ? shown.value.length : null),
  (count) => emit("count", count),
  { immediate: true },
);

/** What the module asks to reach, in a few words, so the player sees it before installing. */
function asks(module: CatalogModuleView): string | null {
  const parts = [...module.permissions.network, ...module.permissions.connectors.map((id) => t(`catalog.connector.${id}`))];
  return parts.length ? t("catalog.asks", { list: parts.join(", ") }) : null;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? t("catalog.sizeKb", { size: Math.max(1, Math.round(bytes / 1024)) }) : t("catalog.sizeMb", { size: (bytes / 1024 / 1024).toFixed(1) });
}

async function install(module: CatalogModuleView) {
  installing.value = module.id;
  const { [module.id]: _, ...rest } = errors.value;
  errors.value = rest;
  const outcome = await act({ type: "install-catalog-module", moduleId: module.id }, { quiet: true });
  installing.value = null;
  if (!outcome.ok) errors.value = { ...errors.value, [module.id]: outcome.error };
}

function add(moduleId: string) {
  addModule(moduleId, (dialog.value as AddModuleRequest).slot ?? null);
}

function settings() {
  dialog.value = null;
  openSettings({ section: "online", setting: "online-search" });
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8" data-testid="catalog-results">
    <p v-if="!result" class="text-muted-foreground py-16 text-center" role="status" data-testid="catalog-loading">{{ t("catalog.loading") }}</p>
    <div v-else-if="result.status !== 'ok'" class="text-muted-foreground py-16 text-center" role="status" :data-testid="`catalog-${result.status}`">
      <p>{{ t(`catalog.status.${result.status}`) }}</p>
      <Button v-if="result.status === 'off'" variant="secondary" class="mt-4" data-testid="catalog-settings" @click="settings">{{ t("catalog.openSettings") }}</Button>
      <Button v-else variant="ghost" class="mt-3" data-testid="catalog-retry" @click="load">{{ t("catalog.retry") }}</Button>
    </div>
    <template v-else>
      <p class="text-muted-foreground flex items-center gap-2 pt-6 pb-3 text-sm"><ShieldCheck class="size-4 flex-none" :stroke-width="1.5" /> {{ t("catalog.hint") }}</p>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        <li v-for="module in shown" :key="module.id" class="bg-background/40 flex flex-col gap-3 rounded-xl border p-4" :data-testid="`catalog-${module.id}`">
          <div class="min-w-0">
            <div class="flex min-w-0 items-baseline gap-2">
              <span class="truncate font-medium" :title="module.name" data-testid="catalog-name">{{ module.name }}</span>
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ module.version }}</span>
            </div>
            <p class="text-muted-foreground truncate text-xs" :title="module.owner" data-testid="catalog-publisher">{{ module.publisher ? t("catalog.by", { name: module.publisher }) : t("catalog.byKey", { key: module.owner.slice(0, 8) }) }}</p>
            <p v-if="module.description" class="text-muted-foreground mt-1.5 line-clamp-2 text-sm" :title="module.description" data-testid="catalog-description">{{ module.description }}</p>
          </div>
          <p v-if="errors[module.id]" class="text-destructive text-sm" role="alert" :data-testid="`catalog-error-${module.id}`">{{ errors[module.id] }}</p>
          <div class="mt-auto flex items-center gap-2">
            <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" :title="asks(module) ?? undefined">{{ size(module.size) }}<template v-if="asks(module)"> · {{ asks(module) }}</template></span>
            <Button v-if="installed.has(module.id)" size="sm" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary shrink-0"
              :data-testid="`catalog-add-${module.id}`" :aria-label="t('addModule.addLabel', { name: module.name })" @click="add(module.id)"
            >{{ t("common.add") }}</Button>
            <Button v-else size="sm" class="shrink-0" :disabled="installing !== null"
              :data-testid="`catalog-install-${module.id}`" :aria-label="t('catalog.installLabel', { name: module.name })" @click="install(module)"
            >{{ installing === module.id ? t("catalog.installing") : t("catalog.install") }}</Button>
          </div>
        </li>
      </ul>
      <p v-if="!shown.length" class="text-muted-foreground py-16 text-center" data-testid="catalog-empty">
        {{ query.trim() ? t("addModule.none", { query: query.trim() }) : t("catalog.empty") }}
      </p>
    </template>
  </div>
</template>
