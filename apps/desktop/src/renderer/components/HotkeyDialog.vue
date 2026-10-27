<script setup lang="ts">
// Tavora's hotkey dialog (HostViewState.hotkeyRequest), opened by a module's hotkeys.set: the user presses the keys
// for one action. Tavora draws it and catches the keys, never the module, which only hears that the action fired.
// The main process lets every hotkey go while it is open, so keys set already can be caught here too.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { hotkeyFromInput, hotkeyKeys } from "../../shared/hotkey-keys";
import { act, state } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const request = computed(() => state.value?.hotkeyRequest ?? null);
const mac = navigator.platform.startsWith("Mac");

/** The keys pressed last, waiting for Save. */
const picked = ref<string | null>(null);
/** Why the keys pressed last can't be a hotkey (said here, before Save). */
const problem = ref<string | null>(null);

watch(
  () => request.value?.id,
  () => {
    picked.value = null;
    problem.value = null;
  },
);

function onKey(event: KeyboardEvent) {
  if (!request.value || event.repeat) return;
  // Escape closes, Tab moves between the buttons; neither can be a hotkey here.
  if (event.code === "Escape" || (event.code === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey)) return;
  if (event.code === "Enter" && picked.value) return;
  event.preventDefault();
  event.stopPropagation();
  const result = hotkeyFromInput(event);
  if ("accelerator" in result) {
    picked.value = result.accelerator;
    problem.value = null;
  } else if (result.problem !== "modifier-only") {
    picked.value = null;
    problem.value = t(result.problem === "needs-modifier" ? "hotkey.needsModifier" : "hotkey.unsupported");
  }
}

onMounted(() => addEventListener("keydown", onKey, true));
onBeforeUnmount(() => removeEventListener("keydown", onKey, true));

const shown = computed(() => picked.value ?? request.value?.current ?? null);
const error = computed(() => problem.value ?? request.value?.error ?? null);

function answer(choice: "set" | "remove" | "cancel") {
  const asked = request.value;
  if (!asked) return;
  if (choice === "set" && picked.value) void act({ type: "hotkey-answer", id: asked.id, choice, accelerator: picked.value });
  else if (choice !== "set") void act({ type: "hotkey-answer", id: asked.id, choice });
}
</script>

<template>
  <ModalDialog
    v-if="request"
    :key="request.id"
    :title="t('hotkey.title', { action: request.actionName })"
    :description="t('hotkey.for', { label: request.label, module: request.moduleName })"
    testid="hotkey-dialog"
    @close="answer('cancel')"
  >
    <div class="bg-muted flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg px-4 py-4 text-center" aria-live="polite" data-testid="hotkey-keys">
      <span v-if="shown" class="flex flex-wrap items-center justify-center gap-1">
        <Kbd v-for="key in hotkeyKeys(shown, mac)" :key="key" class="bg-background min-w-9 rounded-md px-2 py-1 text-sm">{{ key }}</Kbd>
      </span>
      <span v-else class="text-muted-foreground text-sm">{{ t("hotkey.press") }}</span>
      <span v-if="shown && !picked" class="text-muted-foreground text-xs">{{ t("hotkey.now") }}</span>
    </div>
    <p class="text-muted-foreground text-sm">{{ t("hotkey.hint") }}</p>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="hotkey-error">{{ error }}</p>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button v-if="request.current" type="button" variant="danger" class="mr-auto" data-testid="hotkey-remove" @click="answer('remove')">{{ t("hotkey.remove") }}</Button>
      <Button type="button" variant="ghost" data-testid="hotkey-cancel" @click="answer('cancel')">{{ t("common.cancel") }}</Button>
      <Button type="button" :disabled="!picked" data-testid="hotkey-save" @click="answer('set')">{{ t("hotkey.save") }}</Button>
    </div>
  </ModalDialog>
</template>
