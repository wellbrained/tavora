<script setup lang="ts">
import { Plus, UserRoundPlus } from "@lucide/vue";
import { ref } from "vue";
import { act, dialog, state } from "../host";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

// A personal workspace belongs to no game; the rail's Add menu opens this.
const name = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function submit() {
  const value = name.value.replace(/\s+/g, " ").trim();
  if (!value || busy.value) return;
  busy.value = true;
  error.value = null;
  const added = await act({ type: "add-workspace", personal: value }, { quiet: true });
  if (added.ok && added.id) {
    dialog.value = null;
    if (state.value?.library.onboarded) await act({ type: "open-workspace", workspaceId: added.id });
  } else if (!added.ok) {
    error.value = added.error;
  }
  busy.value = false;
}
</script>

<template>
  <ModalDialog :title="t('addPersonal.title')" :description="t('addPersonal.about')" :icon="UserRoundPlus" testid="add-personal-dialog" @close="dialog = null">
    <form class="contents" @submit.prevent="submit">
      <div class="flex flex-col gap-2">
        <label class="text-sm font-medium" for="personal-name">{{ t("addPersonal.name") }}</label>
        <Input id="personal-name" v-model="name" :placeholder="t('addPersonal.placeholder')" autocomplete="off" maxlength="80" data-testid="personal-name" autofocus />
        <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
      </div>
      <DialogFooter>
        <DialogButton type="button" close @click="dialog = null">{{ t("common.cancel") }}</DialogButton>
        <DialogButton type="submit" :icon="Plus" :loading="busy" data-testid="create-personal" :disabled="busy || !name.trim()">{{ t("addPersonal.create") }}</DialogButton>
      </DialogFooter>
    </form>
  </ModalDialog>
</template>
