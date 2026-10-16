<script setup lang="ts">
// The consent dialog (decisions.md, module grants row of 2026-10-16): what a module asks for that the
// player has not granted, shown when the module is first added or when an update asks for more.
// Tavora draws it, never the module, so a module cannot fake or hide what it asks for.
import { Globe } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { act, dialog, nextPanelSlot, state, type GrantRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";
import ModuleIcon from "./ModuleIcon.vue";

const props = defineProps<{ request: GrantRequest }>();
const error = ref<string | null>(null);
const busy = ref(false);

const module = computed(() => state.value?.modules.find((item) => item.id === props.request.moduleId) ?? null);
const hosts = computed(() => module.value?.permissions.missing.network ?? []);

// The module went away, or has nothing left to ask: nothing to answer.
watch(
  [module, hosts],
  () => {
    if (!busy.value && (!module.value || hosts.value.length === 0)) dialog.value = null;
  },
  { immediate: true },
);

const from = computed(() => {
  const current = module.value;
  if (!current) return "";
  if (current.publisher) return t("grant.from.publisher", { key: current.publisher.slice(0, 8) });
  return current.provenance === "official" ? t("grant.from.official") : t("grant.from.local");
});

async function allow() {
  const current = module.value;
  if (!current) return;
  busy.value = true;
  // Exactly what this dialog shows: the main process grants only what the module still asks for.
  const result = await act({ type: "grant-module", moduleId: current.id, network: [...hosts.value] }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  dialog.value = null;
  if (props.request.review) return;
  nextPanelSlot.value = props.request.slot;
  void act({ type: "open-module", moduleId: current.id });
}
</script>

<template>
  <ModalDialog
    v-if="module"
    :title="request.review ? t('grant.reviewTitle', { name: module.name }) : t('grant.title', { name: module.name })"
    class="sm:max-w-[480px]"
    testid="grant-dialog"
    @close="dialog = null"
  >
    <div class="flex items-center gap-3">
      <span class="bg-background text-primary flex size-10 flex-none items-center justify-center rounded-[10px] border" aria-hidden="true">
        <ModuleIcon :module-id="module.id" size="size-5" />
      </span>
      <span class="text-muted-foreground text-sm" data-testid="grant-from">{{ from }}</span>
    </div>
    <section class="flex flex-col gap-2" :aria-label="t('grant.network')">
      <h3 class="flex items-center gap-2 font-medium"><Globe :stroke-width="1.5" class="size-4" /> {{ t("grant.network") }}</h3>
      <ul class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-hosts">
        <li v-for="host in hosts" :key="host" class="font-mono break-all">{{ host }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">{{ t("grant.networkNote") }}</p>
    </section>
    <p class="text-muted-foreground text-sm">{{ t("grant.later") }}</p>
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" autofocus data-testid="grant-cancel" @click="dialog = null">
        {{ request.review ? t("grant.notNow") : t("common.cancel") }}
      </Button>
      <Button type="button" data-testid="grant-allow" :disabled="busy" @click="allow">{{ t("grant.allow") }}</Button>
    </div>
  </ModalDialog>
</template>
