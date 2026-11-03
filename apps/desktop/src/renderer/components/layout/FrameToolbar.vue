<script setup lang="ts">
// The small toolbar next to the selected frame on the canvas, at its top right: the actions the user picked in Customize toolbar
// (by default Settings, Hide on canvas, Reset position, Reset size, and Remove after a thin divider). A submenu button
// (Arrange, Align on screen) is one button with a small arrow that opens that submenu. With several frames selected it keeps
// what works on all of them, each one undo step. It lives in the layer over the canvas, which takes the mouse; LayoutCanvas.vue
// decides where it sits. Each button has a kit tooltip that opens on the side away from the frame, so it never covers what
// you are arranging.
import { ChevronDown } from "@lucide/vue";
import { computed, onBeforeUnmount, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Tooltip } from "@tavora/official-ui/components/tooltip";
import { isGroupAction, offered, selectionOf, type ToolbarActionId } from "../../../shared/layout-toolbar";
import type { LayoutItemView } from "../../../shared/layout-view";
import { t } from "../../i18n";
import { frameActions, type FrameAction } from "./frame-actions";
import { send, view } from "./layout-state";

/** `items`: the selected frames (one or more). `side`: where the toolbar sits next to them, so its tooltips open the other way. */
const props = defineProps<{ items: LayoutItemView[]; side: "top" | "bottom" }>();
const emit = defineEmits<{ done: [] }>();

const copyTargets = computed(() => view.value?.copyTargets ?? []);
const all = computed(() => frameActions(props.items));
const actions = computed<FrameAction[]>(() => {
  const selection = selectionOf(props.items);
  return (view.value?.toolbar.buttons ?? []).filter((id: ToolbarActionId) => offered(id, selection)).map((id: ToolbarActionId) => all.value[id]);
});

const tip = ref<{ text: string; anchor: { left: number; top: number; right: number; bottom: number } } | null>(null);
let delay: ReturnType<typeof setTimeout> | undefined;

function show(event: Event, label: string) {
  const button = event.currentTarget as HTMLElement;
  clearTimeout(delay);
  delay = setTimeout(() => {
    const { left, top, right, bottom } = button.getBoundingClientRect();
    tip.value = { text: label, anchor: { left, top, right, bottom } };
  }, 150);
}

function hide() {
  clearTimeout(delay);
  tip.value = null;
}

function press(action: FrameAction) {
  hide();
  action.run();
  // The layer keeps the keyboard (Del, the arrow keys) once a button was used.
  emit("done");
}

onBeforeUnmount(() => clearTimeout(delay));
</script>

<template>
  <div
    v-if="actions.length"
    class="bg-popover text-popover-foreground absolute z-[100] flex items-center gap-1 rounded-md border p-1 shadow-md"
    role="toolbar"
    :aria-label="items.length > 1 ? t('overlays.layout.manyTools') : t('overlays.layout.itemTools')"
    data-testid="layout-frame-toolbar"
    @pointerdown.stop
  >
    <template v-for="action in actions" :key="action.id">
      <!-- A thin line sets Remove apart from the ones that only change the frame. -->
      <Separator v-if="action.id === 'remove' && actions.length > 1" orientation="vertical" class="mx-0.5 h-5" />
      <DropdownMenu v-if="isGroupAction(action.id)" @update:open="(open: boolean) => (open ? hide() : emit('done'))">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="w-auto gap-0 px-1.5"
            :disabled="action.disabled"
            :aria-label="action.label"
            :data-testid="`layout-frame-${action.id}`"
            @pointerenter="show($event, action.label)"
            @pointerleave="hide"
          >
            <component :is="action.icon" :stroke-width="1.5" />
            <ChevronDown class="size-3" :stroke-width="1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent :side="side === 'top' ? 'bottom' : 'top'" align="end" class="max-h-80 min-w-52">
          <!-- Copy to…: the games; one with frames of its own asks how in a submenu. -->
          <template v-if="action.id === 'copy'">
            <template v-for="game in copyTargets" :key="game.id">
              <DropdownMenuItem v-if="game.frames === 0" :data-testid="`layout-frame-copy-${game.id}`" @select="send({ type: 'copy-setup', to: game.id, mode: 'replace' })">
                <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
                <span class="text-muted-foreground flex-none text-xs">{{ t("overlays.copy.noFrames") }}</span>
              </DropdownMenuItem>
              <DropdownMenuSub v-else>
                <DropdownMenuSubTrigger :data-testid="`layout-frame-copy-${game.id}`">
                  <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
                  <span class="text-muted-foreground flex-none text-xs">{{ t("overlays.copy.frames", { count: game.frames }) }}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem @select="send({ type: 'copy-setup', to: game.id, mode: 'add' })">{{ t("overlays.copy.add") }}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" @select="send({ type: 'copy-setup', to: game.id, mode: 'replace' })">{{ t("overlays.copy.replace") }}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </template>
          </template>
          <DropdownMenuItem v-for="id in action.children" :key="id" :disabled="all[id].disabled" :data-testid="`layout-frame-${id}`" @select="all[id].run()">
            <component :is="all[id].icon" :stroke-width="1.5" />
            {{ all[id].label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        v-else
        variant="ghost"
        size="icon-sm"
        :class="action.id === 'remove' && 'text-destructive hover:text-destructive'"
        :disabled="action.disabled"
        :aria-label="action.label"
        :data-testid="`layout-frame-${action.id}`"
        @pointerenter="show($event, action.label)"
        @pointerleave="hide"
        @focus="($event.target as HTMLElement).matches(':focus-visible') && show($event, action.label)"
        @blur="hide"
        @click="press(action)"
      >
        <component :is="action.icon" :stroke-width="1.5" />
      </Button>
    </template>
    <!-- Drawn on the page, not inside the toolbar, so the layer's edge can't clip it. -->
    <Tooltip :open="tip !== null" :anchor="tip?.anchor" :side="side" compact :description="tip?.text" @dismiss="hide" />
  </div>
</template>
