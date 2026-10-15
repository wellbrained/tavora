<script setup lang="ts">
// A panel's tab: module name, its state, and Reload, Stop and Close. Right-
// click opens the same menu as the group's ⋯ button.
import { RotateCw, Square, X } from "@lucide/vue";
import type { IDockviewPanelHeaderProps } from "dockview-vue";
import { computed, inject } from "vue";
import type { InstanceStatus } from "../../../shared/host-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { act, state } from "../../host";
import { t } from "../../i18n";
import MenuArea from "../menus/MenuArea.vue";
import ModuleIcon from "../ModuleIcon.vue";
import { DOCK, panelMenu } from "./dock-context";

const STATUS_LABEL = (status: InstanceStatus): string => (status === "ready" ? "" : t(`panel.status.${status}`));

const props = defineProps<{ params: IDockviewPanelHeaderProps }>();
const dock = inject(DOCK)!;
const id = props.params.api.id;
const panel = computed(() => state.value?.panels.find((item) => item.instanceId === id));
const status = computed<InstanceStatus>(() => panel.value?.status ?? "loading");

function items() {
  const docked = props.params.containerApi.getPanel(id);
  return docked ? panelMenu(docked, props.params.containerApi, dock.info) : [];
}
</script>

<template>
  <MenuArea :items="items" :title="panel?.name ?? ''">
    <div
      class="flex h-full max-w-72 min-w-0 items-center gap-2 pr-1 pl-3 text-sm"
      :data-testid="`panel-${id}`"
      data-panel-tab
      :data-module-id="panel?.moduleId"
      :data-status="status"
    >
      <ModuleIcon v-if="state?.library.moduleIcons" :module-id="panel?.moduleId" />
      <span class="truncate font-medium">{{ panel?.name }}</span>
      <span
        v-if="STATUS_LABEL(status)"
        :class="
          cn(
            'text-muted-foreground inline-flex flex-none items-center gap-1.5 text-xs',
            (status === 'failed' || status === 'crashed') && 'text-destructive',
            status === 'unresponsive' && 'text-info',
          )
        "
      >
        <span class="size-2 rounded-full bg-current" aria-hidden="true" />{{ STATUS_LABEL(status) }}
      </span>
      <span class="ml-auto flex flex-none" @pointerdown.stop @mousedown.stop>
        <Button
          v-if="status === 'crashed' || status === 'failed'"
          variant="ghost"
          size="icon-xs"
          data-testid="reload"
          :aria-label="t('panel.reloadLabel', { name: panel?.name ?? '' })"
          :title="t('panel.reload')"
          @click.stop="act({ type: 'reload-panel', instanceId: id })"
        >
          <RotateCw :stroke-width="1.5" />
        </Button>
        <Button
          v-if="status === 'unresponsive'"
          variant="ghost"
          size="icon-xs"
          data-testid="stop"
          :aria-label="t('panel.stopLabel', { name: panel?.name ?? '' })"
          :title="t('panel.stop')"
          @click.stop="act({ type: 'stop-panel', instanceId: id })"
        >
          <Square :stroke-width="1.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="close"
          :aria-label="t('panel.closeLabel', { name: panel?.name ?? '' })"
          :title="t('panel.close')"
          @click.stop="act({ type: 'close-panel', instanceId: id })"
        >
          <X :stroke-width="1.5" />
        </Button>
      </span>
    </div>
  </MenuArea>
</template>
