<script setup lang="ts">
// The buttons on the right of the workspace header. The Overlay page shows the same ones in the same places, so the
// header never moves when you switch to it; the ones that belong to a workspace are dimmed and can't be used there.
import { Plus } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { cn } from "@/lib/utils";
import { state } from "../../host";
import { t } from "../../i18n";
import InboxButton from "../messages/InboxButton.vue";
import LayoutsMenu from "./LayoutsMenu.vue";
import ModuleUpdatesButton from "./ModuleUpdatesButton.vue";
import ModulesMenu from "./ModulesMenu.vue";
import OverlayButton from "./OverlayButton.vue";

const props = defineProps<{ onOverlay?: boolean }>();
defineEmits<{ addModule: [] }>();

// The ▾ is always there (the group never changes size); it is off while the workspace has no panel. On the Overlay page the whole
// group is dimmed and can't be used, so the ▾ looks as it did in the workspace.
const hasPanels = computed(() => props.onOverlay || (state.value?.panels.length ?? 0) > 0);
</script>

<template>
  <div class="app-no-drag flex flex-none items-center gap-3">
    <OverlayButton />
    <div class="flex items-center gap-0.5">
      <ModuleUpdatesButton />
      <InboxButton />
    </div>
    <span class="bg-border h-5 w-px flex-none" aria-hidden="true" />
    <div :inert="onOverlay" :class="cn('flex items-center gap-2', onOverlay && 'opacity-50')">
      <LayoutsMenu />
      <ButtonGroup>
        <Button class="h-9 text-sm [&_svg]:size-5" data-testid="add-module" @click="$emit('addModule')">
          <Plus :stroke-width="2" absolute-stroke-width /> {{ t("workspace.addModule") }}
        </Button>
        <ModulesMenu :disabled="!hasPanels" />
      </ButtonGroup>
    </div>
  </div>
</template>
