<script setup lang="ts">
// Publishing a built-in module's update from a dev build (main/official-publish.ts). While the update is built in a
// clean copy of origin/main, the steps show with the current one marked; then the preview shows exactly what Sign and
// upload sends: version, patch notes, files and the commit. The key is the one saved on this PC, or a key file picked
// on Sign and upload (with "Remember the key on this PC"). Cancel stops the build or throws the preview away.
import { Check, ChevronRight, Circle, KeyRound, Loader } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import type { OfficialPublishStep } from "../../../shared/host-api";
import { act, showToast, state } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const BUILD_STEPS: OfficialPublishStep[] = ["fetch", "check", "worktree", "install", "build", "pack"];
const UPLOAD_STEPS: OfficialPublishStep[] = ["sign", "upload"];

const view = computed(() => state.value?.officialPublish ?? null);
const run = computed(() => view.value?.run ?? null);
const preview = computed(() => run.value?.preview ?? null);
const key = computed(() => view.value?.key ?? { saved: false, canRemember: false });
/** Signing or uploading: nothing can be cancelled then. */
const uploading = computed(() => preview.value !== null && UPLOAD_STEPS.includes(run.value!.step));
const busy = ref(false);
const remember = ref(false);
const filesOpen = ref(false);

const steps = computed(() => {
  const list = preview.value ? UPLOAD_STEPS : BUILD_STEPS;
  const at = run.value ? list.indexOf(run.value.step) : -1;
  return list.map((step, index) => ({ step, state: index < at ? "done" : index === at ? "now" : "todo" }));
});

const title = computed(() => {
  if (!run.value) return "";
  return preview.value && !uploading.value ? t("officialPublish.preview.title", { name: preview.value.name, version: preview.value.version }) : t("officialPublish.dialog.title", { name: run.value.name });
});

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? t("catalog.sizeKb", { size: Math.max(1, Math.round(bytes / 1024)) }) : t("catalog.sizeMb", { size: (bytes / 1024 / 1024).toFixed(1) });
}

async function upload() {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await act({ type: "official-publish-confirm", remember: !key.value.saved && key.value.canRemember && remember.value });
    if (result.ok && result.id) showToast(t("officialPublish.done", { name: result.id }));
  } finally {
    busy.value = false;
  }
}

function cancel() {
  if (!uploading.value && !busy.value) void act({ type: "official-publish-cancel" });
}
</script>

<template>
  <ModalDialog v-if="run" :title="title" class="sm:max-w-[520px]" testid="official-publish-dialog" @close="cancel">
    <!-- Building, signing or uploading: the steps, with the current one marked. -->
    <template v-if="!preview || uploading">
      <ol class="flex flex-col gap-2 text-sm" :aria-label="title" data-testid="official-publish-steps">
        <li v-for="item in steps" :key="item.step" class="flex items-center gap-2" :data-step="item.step" :data-state="item.state" :aria-current="item.state === 'now' ? 'step' : undefined">
          <Check v-if="item.state === 'done'" class="text-success size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <Loader v-else-if="item.state === 'now'" class="text-primary size-4 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.5" aria-hidden="true" />
          <Circle v-else class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <span :class="item.state === 'todo' ? 'text-muted-foreground' : ''">{{ t(`officialPublish.step.${item.step}`) }}</span>
        </li>
      </ol>
      <p v-if="!preview" class="text-muted-foreground text-sm">{{ t("officialPublish.dialog.hint") }}</p>
      <div class="flex justify-end">
        <Button variant="secondary" :disabled="uploading" data-testid="official-publish-cancel" @click="cancel">{{ t("common.cancel") }}</Button>
      </div>
    </template>

    <!-- The preview: exactly what Sign and upload sends. -->
    <template v-else>
      <ul class="text-muted-foreground flex flex-col gap-1 text-sm" data-testid="official-publish-preview">
        <li>
          <span class="text-foreground">{{ t("officialPublish.preview.version") }}</span>
          <span class="tabular-nums"> {{ t("officialPublish.versions", { shipped: preview.shipped, version: preview.version }) }}</span>
        </li>
        <li>{{ preview.listed ? t("officialPublish.preview.listed", { listed: preview.listed }) : t("officialPublish.preview.notListed") }}</li>
        <li>{{ t("officialPublish.preview.minTavora", { version: preview.minTavora }) }}</li>
        <li>{{ t("officialPublish.preview.commit", { commit: preview.commit.slice(0, 8) }) }}</li>
      </ul>

      <div class="flex flex-col gap-1" data-testid="official-publish-notes">
        <span class="text-sm font-medium">{{ t("officialPublish.preview.notes") }}</span>
        <ul v-if="preview.notes.length" class="text-muted-foreground list-disc pl-5 text-sm">
          <li v-for="(line, index) in preview.notes" :key="index">{{ line }}</li>
        </ul>
        <span v-else class="text-muted-foreground text-sm">{{ t("officialPublish.preview.noNotes") }}</span>
      </div>

      <Collapsible v-model:open="filesOpen" class="flex flex-col gap-1" data-testid="official-publish-files">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="w-fit px-1">
            <ChevronRight :class="['size-4 transition-transform motion-reduce:transition-none', filesOpen ? 'rotate-90' : '']" :stroke-width="1.5" aria-hidden="true" />
            {{ t("officialPublish.preview.files", { count: preview.files.length, size: size(preview.size) }) }}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul class="text-muted-foreground max-h-48 overflow-y-auto pl-6 font-mono text-xs">
            <li v-for="file in preview.files" :key="file.name" class="flex justify-between gap-4">
              <span class="truncate">{{ file.name }}</span>
              <span class="flex-none tabular-nums">{{ size(file.size) }}</span>
            </li>
          </ul>
        </CollapsibleContent>
      </Collapsible>

      <p v-if="key.saved" class="text-muted-foreground flex items-center gap-2 text-sm" data-testid="official-publish-saved-key">
        <KeyRound class="size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
        {{ t("officialPublish.preview.savedKey") }}
      </p>
      <label v-else-if="key.canRemember" class="flex items-start gap-2 text-sm">
        <Checkbox v-model="remember" class="mt-0.5 flex-none" data-testid="official-publish-remember" />
        <span class="flex flex-col gap-0.5">
          <span>{{ t("officialPublish.preview.remember") }}</span>
          <span class="text-muted-foreground">{{ t("officialPublish.preview.rememberHint") }}</span>
        </span>
      </label>

      <div class="flex items-center justify-end gap-2">
        <Button variant="secondary" :disabled="busy" data-testid="official-publish-cancel" @click="cancel">{{ t("common.cancel") }}</Button>
        <Button :disabled="busy" data-testid="official-publish-upload" @click="upload">
          {{ key.saved ? t("officialPublish.preview.upload") : t("officialPublish.preview.chooseKey") }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
