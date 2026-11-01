<script setup lang="ts">
// Screen 3, personal pick: a personal workspace with the built-in panels the user ticks (Notes and To-Dos
// ticked at first). Continue makes the workspace; its panels open once the welcome ends.
import { ArrowLeft } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { act, state } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";

/** The personal workspace made here, and the panels to open in it once the welcome ends. */
export interface StartedPersonal {
  id: string;
  moduleIds: string[];
}

/** The built-in modules offered, in this order. */
const OFFERED = ["tavora.notes", "tavora.todos", "tavora.clock-counter", "tavora.whiteboard", "tavora.pdf-viewer"] as const;
const DEFAULT_TICKED = ["tavora.notes", "tavora.todos"];

/** `dry`: the welcome is only tried (dev build): no workspace is made, it is pretended. */
const props = defineProps<{ started: StartedPersonal | null; dry?: boolean }>();
const emit = defineEmits<{ start: [StartedPersonal]; next: []; back: [] }>();

const offered = computed(() => OFFERED.flatMap((id) => state.value!.modules.filter((module) => module.id === id)));
const ticked = ref<Set<string>>(new Set(props.started?.moduleIds ?? DEFAULT_TICKED));
const busy = ref(false);
const error = ref<string | null>(null);

function toggle(id: string, on: boolean | "indeterminate") {
  const next = new Set(ticked.value);
  if (on === true) next.add(id);
  else next.delete(id);
  ticked.value = next;
}

async function create() {
  if (busy.value) return;
  const moduleIds = OFFERED.filter((id) => ticked.value.has(id));
  let id = props.started?.id;
  // Back and Continue again keeps the workspace made the first time.
  if (!id) {
    busy.value = true;
    error.value = null;
    const result = props.dry ? { ok: true as const, id: "dry-run" } : await act({ type: "add-workspace", personal: t("onboarding.personal.workspace") }, { quiet: true });
    busy.value = false;
    if (!result.ok || !result.id) {
      if (!result.ok) error.value = result.error;
      return;
    }
    id = result.id;
  }
  emit("start", { id, moduleIds });
  emit("next");
}
</script>

<template>
  <section class="flex w-full max-w-[520px] flex-col items-center text-center" data-testid="onboarding-personal">
    <h1 class="text-3xl font-semibold">{{ t("onboarding.personal.title") }}</h1>
    <p class="text-muted-foreground mt-2 mb-5 [@media(max-height:640px)]:mb-3">{{ t("onboarding.personal.sub") }}</p>

    <ul class="grid w-full grid-cols-2 gap-2 text-left max-[760px]:grid-cols-1 max-[760px]:gap-1.5" :aria-label="t('onboarding.personal.panels')">
      <li v-for="module in offered" :key="module.id" class="bg-card rounded-lg border">
        <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5">
          <Checkbox :model-value="ticked.has(module.id)" :data-testid="`onboarding-panel-${module.id}`" @update:model-value="(on: boolean | 'indeterminate') => toggle(module.id, on)" />
          <ModuleIcon :module-id="module.id" size="size-5" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ module.name }}</span>
        </label>
      </li>
    </ul>
    <p v-if="error" class="text-destructive mt-2 text-sm" role="alert" data-testid="onboarding-error">{{ error }}</p>

    <div class="mt-6 flex items-center gap-3 [@media(max-height:640px)]:mt-3">
      <Button variant="ghost" data-testid="onboarding-back" @click="$emit('back')"><ArrowLeft :stroke-width="1.5" /> {{ t("common.back") }}</Button>
      <Button class="min-w-32" :disabled="busy" data-testid="onboarding-next" @click="create">{{ t("common.next") }}</Button>
    </div>
  </section>
</template>
