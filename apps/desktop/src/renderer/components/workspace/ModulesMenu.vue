<script setup lang="ts">
// The ▾ joined to the toolbar's Add module button: the modules in this workspace
// with their panel types, to add one not open yet or bring an open one to the
// front (workspaceModulesMenu). Always there, so the group never changes size; off while the workspace has no panel.
import { ChevronDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { useFloating } from "../../host";
import { t } from "../../i18n";
import MenuEntries from "../menus/MenuEntries.vue";
import { workspaceModulesMenu } from "./dock-context";

defineProps<{ disabled?: boolean }>();
const track = useFloating();
</script>

<template>
  <DropdownMenu @update:open="track">
    <DropdownMenuTrigger as-child>
      <Button
        :disabled="disabled"
        class="h-9 px-2 [&_svg]:size-5"
        data-testid="modules-in-game"
        :aria-label="t('workspace.modulesHere')"
        :title="t('workspace.modulesHere')"
      >
        <ChevronDown :stroke-width="2" absolute-stroke-width />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-testid="menu" side="bottom" align="end" class="max-w-72 min-w-56">
      <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ t("workspace.modulesHere") }}</DropdownMenuLabel>
      <MenuEntries :items="workspaceModulesMenu()" kind="dropdown" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
