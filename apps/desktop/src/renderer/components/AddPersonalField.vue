<script setup lang="ts">
// Start a personal workspace (one that belongs to no game): just its name, typed right in the rail. Expanded (`inline`),
// it is a row above the Add row, drawn like the workspace it will become; compact, the field hangs off the Personal
// tile (`anchor`). Enter adds it and opens it; Esc or a click elsewhere drops it, and the focus goes back to Personal.
import { createReusableTemplate, useEventListener } from "@vueuse/core";
import { UserRound } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { useTask } from "@tavora/official-ui/use-task";
import { cn } from "@tavora/official-ui/lib/utils";
import { act, state, useFloating } from "../host";
import { t } from "../i18n";

const props = defineProps<{ anchor: HTMLElement | null; inline: boolean }>();
const open = defineModel<boolean>("open", { required: true });
const name = ref("");
const field = ref<InstanceType<typeof Input> | null>(null);
const row = ref<HTMLElement | null>(null);
/** The work behind Enter: it always ends (a throw shows as an error), so the field is usable again. */
const task = useTask({ describe: () => t("error.generic") });
/** The service's own answer when it did not go through; a request that threw is the task's error. */
const answered = ref<string | null>(null);
const error = computed(() => answered.value ?? task.error.value);
const typed = computed(() => name.value.replace(/\s+/g, " ").trim());
const [DefineForm, Form] = createReusableTemplate();

// Compact, the field floats over the page: module panels (native views above it) step aside for their pictures.
const setFloating = useFloating();
watch(
  () => open.value && !props.inline,
  (floating) => setFloating(floating),
);

// Each time it opens it starts empty; inline, it takes the focus (the popover gives it to its first field itself).
watch(open, async (now) => {
  if (!now) return;
  name.value = "";
  answered.value = null;
  if (!props.inline) return;
  await nextTick();
  (field.value?.$el as HTMLInputElement | undefined)?.focus();
});

/** Drop it. From Esc the focus goes back to the Personal button. */
async function cancel(refocus: boolean) {
  if (task.busy.value) return;
  open.value = false;
  if (!refocus) return;
  // Compact, the popover's field goes first, so the button is focused after it.
  await nextTick();
  document.querySelector<HTMLElement>('[data-testid="rail-add-personal"]')?.focus();
}

/** Esc drops the inline field; compact, the popover closes itself on it. */
function onEscape(event: KeyboardEvent) {
  if (!props.inline) return;
  event.preventDefault();
  event.stopPropagation();
  void cancel(true);
}

// Inline, a click or a Tab out of the row drops it; a click inside it (its error) or switching to another window does
// not, and a click on Personal is its own toggle. While it adds, it stays; a later click elsewhere drops it if that
// went wrong.
useEventListener(document, "pointerdown", (event) => {
  const target = event.target as Node;
  if (props.inline && open.value && !row.value?.contains(target) && !props.anchor?.contains(target)) void cancel(false);
});
function onFocusOut(event: FocusEvent) {
  const to = event.relatedTarget as Node | null;
  if (to && !row.value?.contains(to) && !props.anchor?.contains(to)) void cancel(false);
}

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
  <DefineForm>
    <form class="flex min-w-0 flex-1 flex-col gap-1.5" data-testid="add-personal" :data-status="task.state.value.status" @submit.prevent="submit">
      <Input
        ref="field"
        v-model="name"
        :class="cn('h-8 min-w-0', inline && 'border-primary rounded-none border-0 border-b-[1.5px] bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0 dark:bg-transparent')"
        :aria-label="t('rail.addPersonal')"
        :placeholder="t('addPersonal.placeholder')"
        autocomplete="off"
        maxlength="80"
        data-testid="personal-name"
        @keydown.esc="onEscape"
      />
      <Notice v-if="error" variant="error" data-testid="add-personal-error">{{ error }}</Notice>
    </form>
  </DefineForm>

  <!-- Expanded: in the rail itself, a row like the workspace it will become. -->
  <div v-if="inline && open" ref="row" class="rail-entry flex px-2" data-testid="add-personal-row" @focusout="onFocusOut">
    <div class="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-1">
      <span class="bg-card text-primary flex size-10 flex-none items-center justify-center rounded-[10px]" aria-hidden="true">
        <UserRound class="size-5" :stroke-width="1.75" />
      </span>
      <div class="flex min-w-0 flex-1 pt-1"><Form /></div>
    </div>
  </div>

  <!-- Compact: next to the Personal tile, just the field. -->
  <Popover v-else-if="!inline" v-model:open="open">
    <!-- Placed by the Personal tile's box; its own (empty) element takes no room in the rail. -->
    <PopoverAnchor :reference="props.anchor ?? undefined" class="hidden" />
    <PopoverContent
      side="right"
      align="center"
      :side-offset="8"
      class="w-64 p-2"
      data-testid="add-personal-popover"
      @interact-outside="onOutside"
      @close-auto-focus.prevent="props.anchor?.querySelector('button')?.focus()"
    >
      <Form />
    </PopoverContent>
  </Popover>
</template>
