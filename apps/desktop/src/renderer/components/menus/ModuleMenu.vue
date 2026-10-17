<script setup lang="ts">
// A module's menu (ui.showMenu), drawn here because module panels are native views above this
// page: a menu inside a panel is cut off at the panel's edge. While it is open the panels show as
// still images (useFloating), so the menu lies above all of them. The main process checked the
// entries and only accepts an answer it offered.
import { computed, ref, watch } from "vue";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, moduleMenu, useFloating } from "../../host";
import ModuleMenuEntries from "./ModuleMenuEntries.vue";

const track = useFloating();
const open = ref(false);
/** The rectangle the menu opens next to, in this page's pixels. */
const anchor = ref({ left: 0, top: 0, width: 0, height: 0 });

watch(
  moduleMenu,
  (menu) => {
    if (!menu) {
      open.value = false;
      track(false);
      return;
    }
    // `at` is in the panel's pixels; the panel's view lies exactly over its content box here.
    const box = document.querySelector(`[data-testid="panel-content-${CSS.escape(menu.instanceId)}"]`)?.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));
    const x = clamp(menu.at.x, box?.width ?? 0);
    const y = clamp(menu.at.y, box?.height ?? 0);
    anchor.value = {
      left: (box?.left ?? 0) + x,
      top: (box?.top ?? 0) + y,
      width: Math.min(menu.at.width ?? 0, (box?.width ?? 0) - x),
      height: Math.min(menu.at.height ?? 0, (box?.height ?? 0) - y),
    };
    open.value = true;
    track(true);
  },
  { immediate: true },
);

/** Tells the module what was chosen (null: nothing), once. */
function answer(id: string | null) {
  const menu = moduleMenu.value;
  if (!menu) return;
  moduleMenu.value = null;
  api.answerModuleMenu(menu.requestId, id);
}

function onOpenChange(value: boolean) {
  if (!value) answer(null);
}

const side = computed(() => moduleMenu.value?.side ?? "bottom");
const align = computed(() => moduleMenu.value?.align ?? "start");
</script>

<template>
  <DropdownMenu v-if="moduleMenu" :open="open" @update:open="onOpenChange">
    <DropdownMenuTrigger as-child>
      <div
        class="pointer-events-none fixed"
        :style="{ left: `${anchor.left}px`, top: `${anchor.top}px`, width: `${anchor.width}px`, height: `${anchor.height}px` }"
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent :side="side" :align="align" :side-offset="anchor.height ? 4 : 0" class="max-w-72 min-w-44" data-testid="module-menu">
      <ModuleMenuEntries :entries="moduleMenu.items" @choose="answer" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
