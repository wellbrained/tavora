<script lang="ts">
import { ref } from "vue";

// The ▾ beside Add module is there once the workspace has a panel. The Overlay page has no panels open, so it keeps what the
// workspace it was opened from had; kept here, outside any one header, because the page's header is a new one.
const hasPanels = ref(false);
</script>

<script setup lang="ts">
// The buttons on the right of the workspace header. The Overlay page shows the same ones in the same places, so the
// header never moves when you switch to it; the ones that belong to a workspace are dimmed and can't be used there.
import { Plus } from "@lucide/vue";
import { watchEffect } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { cn } from "@/lib/utils";
import { state } from "../../host";
import { t } from "../../i18n";
import InboxButton from "../messages/InboxButton.vue";
import LayoutsMenu from "./LayoutsMenu.vue";
import ModuleUpdatesButton from "./ModuleUpdatesButton.vue";
import ModulesMenu from "./ModulesMenu.vue";

const props = defineProps<{ onOverlay?: boolean }>();
defineEmits<{ addModule: [] }>();

watchEffect(() => {
  if (!props.onOverlay) hasPanels.value = (state.value?.panels.length ?? 0) > 0;
});
</script>

<template>
  <div class="app-no-drag flex flex-none items-center gap-2">
    <ModuleUpdatesButton />
    <InboxButton />
    <div :inert="onOverlay" :class="cn('flex items-center gap-2', onOverlay && 'opacity-50')">
      <LayoutsMenu />
      <ButtonGroup>
        <Button size="sm" variant="secondary" data-testid="add-module" @click="$emit('addModule')">
          <Plus :stroke-width="1.5" /> {{ t("workspace.addModule") }}
        </Button>
        <ModulesMenu v-if="hasPanels" />
      </ButtonGroup>
    </div>
  </div>
</template>
