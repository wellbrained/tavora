<script setup lang="ts">
// Start a personal workspace (one that belongs to no game): just its name, in a popover next to the rail's Personal
// button (`anchor`). Enter or the button adds it and opens it; Esc or a click elsewhere closes the popover, and the
// focus goes back to the Personal button.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { useTask } from "@tavora/official-ui/use-task";
import { act, state, useFloating } from "../host";
import { t } from "../i18n";

const props = defineProps<{ anchor: HTMLElement | null }>();
const open = defineModel<boolean>("open", { required: true });
const name = ref("");
/** The work behind the button: it always ends (a throw shows as an error), so the button is usable again. */
const task = useTask({ describe: () => t("error.generic") });
/** The service's own answer when it did not go through; a request that threw is the task's error. */
const answered = ref<string | null>(null);
const error = computed(() => answered.value ?? task.error.value);
const typed = computed(() => name.value.replace(/\s+/g, " ").trim());

// Module panels are native views above this page: while it is open they step aside for their pictures, as for a menu.
const setFloating = useFloating();

// Each time it opens it starts empty.
watch(open, (now) => {
  setFloating(now);
  if (!now) return;
  name.value = "";
  answered.value = null;
});

/** A press on the Personal button itself is its own toggle, not a click elsewhere: the button closes it. */
function onOutside(event: Event) {
  if (props.anchor?.contains(event.target as Node)) event.preventDefault();
}

async function submit() {
  if (!typed.value || task.busy.value) return;
  const value = typed.value;
  answered.value = null;
  await task.run(async () => {
    const added = await act({ type: "add-workspace", personal: value }, { quiet: true });
    if (!added.ok) {
      answered.value = added.error;
      return;
    }
    open.value = false;
    if (added.id && state.value?.library.onboarded) await act({ type: "open-workspace", workspaceId: added.id });
  });
}
</script>

<template>
  <Popover v-model:open="open">
    <!-- Placed by the Personal button's box; its own (empty) element takes no room in the rail. -->
    <PopoverAnchor :reference="props.anchor ?? undefined" class="hidden" />
    <PopoverContent
      side="right"
      align="start"
      :side-offset="8"
      class="w-80"
      data-testid="add-personal-popover"
      :data-status="task.state.value.status"
      @interact-outside="onOutside"
      @close-auto-focus.prevent="props.anchor?.querySelector('button')?.focus()"
    >
      <form class="flex flex-col gap-2" @submit.prevent="submit">
        <label class="text-sm font-medium" for="personal-name">{{ t("addPersonal.title") }}</label>
        <div class="flex gap-2">
          <Input id="personal-name" v-model="name" class="min-w-0 flex-1" :placeholder="t('addPersonal.placeholder')" autocomplete="off" maxlength="80" data-testid="personal-name" />
          <Button type="submit" :disabled="!typed || task.busy.value" :disabled-reason="typed ? undefined : t('addPersonal.nameFirst')" data-testid="create-personal">{{ t("addPersonal.add") }}</Button>
        </div>
        <Notice v-if="error" variant="error" data-testid="add-personal-error">{{ error }}</Notice>
      </form>
    </PopoverContent>
  </Popover>
</template>
