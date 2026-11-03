<script setup lang="ts">
// The right-click menu of a frame on the canvas (the kit's ContextMenu around the frame opens it next to the frame, never at
// the pointer; LayoutCanvas.vue also opens it from the keyboard). With several frames selected it holds what works on all of
// them, like the toolbar. Rows hold an icon, a label and, at the end, a shortcut or the arrow of a submenu. What the toolbar
// shows is picked in Customize toolbar… (ToolbarCustomize.vue).
import { Copy, SlidersHorizontal } from "@lucide/vue";
import { computed } from "vue";
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
import type { LayoutItemView } from "../../../shared/layout-view";
import { offered, selectionOf, type FrameActionId } from "../../../shared/layout-toolbar";
import { t } from "../../i18n";
import { frameActions, type FrameAction } from "./frame-actions";
import { send, view } from "./layout-state";

/** `items`: the frames the menu is for (the selected ones). */
const props = defineProps<{ items: LayoutItemView[] }>();
const emit = defineEmits<{ closed: []; customize: [] }>();

const actions = computed(() => frameActions(props.items));
const selection = computed(() => selectionOf(props.items));
const toolbar = computed(() => view.value?.toolbar ?? { show: true, buttons: [] });
const copyTargets = computed(() => view.value?.copyTargets ?? []);

const row = (id: FrameActionId): FrameAction => actions.value[id];
const shown = (id: FrameActionId) => offered(id, selection.value);

/** Copy to… games with frames of their own ask what to do: both ways are rows, Replace is the one to be careful with. */
const copy = (to: string, mode: "replace" | "add") => send({ type: "copy-setup", to, mode });
</script>

<template>
  <ContextMenuContent
    side="right"
    align="start"
    class="min-w-56"
    :aria-label="items.length > 1 ? t('overlays.layout.manyTools') : t('overlays.layout.itemTools')"
    data-testid="layout-frame-menu"
    @close-auto-focus="(event: Event) => (event.preventDefault(), emit('closed'))"
  >
    <ContextMenuItem v-if="shown('settings')" :disabled="row('settings').disabled" data-testid="layout-menu-settings" @select="row('settings').run()">
      <component :is="row('settings').icon" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ row("settings").label }}…</span>
    </ContextMenuItem>
    <ContextMenuSub>
      <ContextMenuSubTrigger :disabled="copyTargets.length === 0" data-testid="layout-menu-copy">
        <Copy :stroke-width="1.5" />
        <span class="min-w-0 flex-1 truncate">{{ t("overlays.copy.button") }}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent class="max-h-80 max-w-72 min-w-52" data-testid="layout-menu-copy-list">
        <template v-for="game in copyTargets" :key="game.id">
          <!-- A game without frames takes the copy at once; one with frames asks how, in a submenu. -->
          <ContextMenuItem v-if="game.frames === 0" :data-testid="`layout-menu-copy-${game.id}`" @select="copy(game.id, 'replace')">
            <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
            <span class="text-muted-foreground flex-none text-xs">{{ t("overlays.copy.noFrames") }}</span>
          </ContextMenuItem>
          <ContextMenuSub v-else>
            <ContextMenuSubTrigger :data-testid="`layout-menu-copy-${game.id}`">
              <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
              <span class="text-muted-foreground flex-none text-xs">{{ t("overlays.copy.frames", { count: game.frames }) }}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem @select="copy(game.id, 'add')">{{ t("overlays.copy.add") }}</ContextMenuItem>
              <ContextMenuItem variant="destructive" @select="copy(game.id, 'replace')">{{ t("overlays.copy.replace") }}</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </template>
      </ContextMenuSubContent>
    </ContextMenuSub>
    <ContextMenuSeparator />

    <template v-for="group in ['arrange', 'align'] as const" :key="group">
      <ContextMenuSub>
        <ContextMenuSubTrigger :disabled="row(group).disabled" :data-testid="`layout-menu-${group}`">
          <component :is="row(group).icon" :stroke-width="1.5" />
          <span class="min-w-0 flex-1 truncate">{{ row(group).label }}</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent class="min-w-52">
          <ContextMenuItem v-for="id in row(group).children" :key="id" :disabled="row(id).disabled" :data-testid="`layout-menu-${id}`" @select="row(id).run()">
            <component :is="row(id).icon" :stroke-width="1.5" />
            <span class="min-w-0 flex-1 truncate">{{ row(id).label }}</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </template>
    <ContextMenuItem data-testid="layout-menu-lock" @select="row('lock').run()">
      <component :is="row('lock').icon" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ row("lock").label }}</span>
    </ContextMenuItem>
    <ContextMenuSeparator />

    <ContextMenuItem v-for="id in ['hide', 'reset', 'reset-size'] as const" :key="id" :disabled="row(id).disabled" :data-testid="`layout-menu-${id}`" @select="row(id).run()">
      <component :is="row(id).icon" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ row(id).label }}</span>
    </ContextMenuItem>
    <ContextMenuSeparator />

    <!-- The toolbar group: turn it off, or pick what is in it. -->
    <ContextMenuCheckboxItem :model-value="toolbar.show" data-testid="layout-menu-toolbar" @select="send({ type: 'toolbar', show: !toolbar.show })">
      {{ t("overlays.layout.showToolbar") }}
    </ContextMenuCheckboxItem>
    <ContextMenuItem data-testid="layout-menu-customize" @select="emit('customize')">
      <SlidersHorizontal :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ t("overlays.layout.customizeToolbar") }}…</span>
    </ContextMenuItem>
    <ContextMenuSeparator />

    <ContextMenuItem variant="destructive" data-testid="layout-menu-remove" @select="row('remove').run()">
      <component :is="row('remove').icon" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ row("remove").label }}</span>
      <ContextMenuShortcut>Del</ContextMenuShortcut>
    </ContextMenuItem>
  </ContextMenuContent>
</template>
