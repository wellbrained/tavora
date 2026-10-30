<script setup lang="ts">
// Make a copy of an example that ships with Tavora: the developer names their module and says where its
// project goes, in one of their project folders or a folder they pick next. Main copies the sources into
// a new folder named after the module, gives it its own id, and loads it from there (main/example-copy.ts). Settings
// then shows Project folders, where the new project waits for its first build.
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { act, dialog, openSettings, settingsOpen, showToast, state } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const props = defineProps<{ moduleId: string }>();

/** The radio value for a folder picked in the system's dialog after Copy. */
const ELSEWHERE = "";

const example = computed(() => state.value!.modules.find((module) => module.id === props.moduleId));
/** The project folders a new project can go in: ones that hold projects, not a project itself, and that still exist. */
const folders = computed(() =>
  state.value!.developmentFolders.filter((entry) => entry.kind !== "missing" && !entry.projects.some((project) => project.project === entry.folder)).map((entry) => entry.folder),
);

const short = props.moduleId.replace(/^local\.example\./, "").replace(/-module$/, "");
const name = ref(t(`examples.defaultName.${short}` as "examples.defaultName.vue"));
const where = ref(folders.value[0] ?? ELSEWHERE);
const error = ref<string | null>(null);
const busy = ref(false);

/** A long path shortened at its start, so the end, which tells folders apart, stays readable. */
function shortPath(folder: string): string {
  const all = folder.split(/[\\/]/).filter(Boolean);
  if (all.length <= 3) return folder;
  const sep = folder.includes("\\") ? "\\" : "/";
  return `…${sep}${all.slice(-2).join(sep)}`;
}

async function submit() {
  if (busy.value || !name.value.trim()) return;
  busy.value = true;
  error.value = null;
  const result = await act({ type: "copy-example", moduleId: props.moduleId, name: name.value.trim(), folder: where.value === ELSEWHERE ? null : where.value }, { quiet: true });
  busy.value = false;
  if (!result.ok) error.value = result.error;
  else if (result.id) {
    dialog.value = null;
    if (settingsOpen.value) openSettings({ section: "dev-folders" });
    showToast(t("examples.copied", { folder: result.id.split(/[\\/]/).at(-1) ?? result.id }));
  }
}
</script>

<template>
  <ModalDialog :title="t('examples.copyTitle', { name: example?.name ?? '' })" :description="t('examples.copyText')" testid="copy-example-dialog" @close="dialog = null">
    <form class="grid gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label for="copy-example-name" class="text-muted-foreground font-normal">{{ t("examples.nameLabel") }}</Label>
        <Input
          id="copy-example-name"
          v-model="name"
          data-testid="copy-example-name"
          maxlength="80"
          :aria-invalid="error ? true : undefined"
          autofocus
          @focus="($event.target as HTMLInputElement).select()"
        />
      </div>
      <div class="grid gap-2">
        <span id="copy-example-where" class="text-muted-foreground text-sm">{{ t("examples.whereLabel") }}</span>
        <RadioGroup v-if="folders.length" v-model="where" class="gap-2" aria-labelledby="copy-example-where">
          <Label v-for="folder in folders" :key="folder" class="min-w-0 font-normal" :title="folder">
            <RadioGroupItem :value="folder" data-testid="copy-example-folder" />
            <span class="truncate font-mono text-sm">{{ shortPath(folder) }}</span>
          </Label>
          <Label class="font-normal">
            <RadioGroupItem :value="ELSEWHERE" data-testid="copy-example-elsewhere" />
            {{ t("examples.elsewhere") }}
          </Label>
        </RadioGroup>
        <p v-else class="text-sm">{{ t("examples.pickNext") }}</p>
      </div>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="copy-example-error">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" @click="dialog = null">{{ t("common.cancel") }}</Button>
        <Button type="submit" data-testid="copy-example-submit" :disabled="busy || !name.trim()">{{ t("examples.copyButton") }}</Button>
      </div>
    </form>
  </ModalDialog>
</template>
