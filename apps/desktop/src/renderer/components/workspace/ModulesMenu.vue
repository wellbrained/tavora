<script setup lang="ts">
// The ▾ joined to the toolbar's Add module button: the modules in this game
// with their panel types, to add one not open yet or bring an open one to the
// front (gameModulesMenu). Shown once the game has a panel.
import { ChevronDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { useFloating } from "../../host";
import { t } from "../../i18n";
import MenuEntries from "../menus/MenuEntries.vue";
import { gameModulesMenu } from "./dock-context";

const track = useFloating();
</script>

<template>
  <DropdownMenu @update:open="track">
    <DropdownMenuTrigger as-child>
      <Button
        size="sm"
        variant="secondary"
        class="rounded-l-none border-l border-black/20 px-1.5"
        data-testid="modules-in-game"
        :aria-label="t('workspace.modulesInGame')"
        :title="t('workspace.modulesInGame')"
      >
        <ChevronDown :stroke-width="1.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-testid="menu" side="bottom" align="end" class="max-w-72 min-w-56">
      <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ t("workspace.modulesInGame") }}</DropdownMenuLabel>
      <MenuEntries :items="gameModulesMenu()" kind="dropdown" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
