<script setup lang="ts">
// A row of tabs that can be closed, dragged into a new order and renamed in place. The tabs belong to the
// caller: the strip only reports what the user did, and the caller changes its list.
//
// - Close: the X, a middle click, or Delete / Backspace on a focused tab. Closing the open tab first opens its
//   neighbour (`update:modelValue`), then `close` follows.
// - Reorder: drag a tab (a line shows where it lands; Esc puts it back), or press Alt + ← / → on a focused tab.
//   `reorder` carries the whole new order of ids, once per move.
// - Rename: double-click or F2 on a `renamable` tab. Enter or leaving the field keeps the name, Esc drops it.
// - Icon: the scoped `icon` slot (`{ tab }`) puts an icon before a tab's label. It stays while the tab is renamed
//   and is not part of the rename field's text. Give it its own look (e.g. `text-primary size-3.5`) and a tooltip.
// - A row that is too wide scrolls with the wheel and fades at the edges. The `add` slot sits after the row, always visible.
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { X } from "@lucide/vue";
import { TabsRoot } from "reka-ui";
import { cn } from "../../../lib/utils";
import { Input } from "../input";
import { uiText } from "../text";
import { DEFAULT_NAME_LIMIT } from "../../name-check";
import TabsList from "./TabsList.vue";
import TabsTrigger from "./TabsTrigger.vue";
import { checkRename, dropPlace, moveTab, neighbourAfterClose, stepTab, type StripTab } from "./tab-strip";

const props = withDefaults(defineProps<{ tabs: StripTab[]; modelValue?: string; maxLength?: number; ariaLabel?: string; class?: string }>(), {
  maxLength: DEFAULT_NAME_LIMIT,
});
const emit = defineEmits<{
  "update:modelValue": [id: string];
  close: [id: string];
  reorder: [ids: string[]];
  rename: [id: string, label: string];
}>();

const scroller = ref<HTMLElement | null>(null);
const canScrollBack = ref(false);
const canScrollForward = ref(false);

const ids = () => props.tabs.map((tab) => tab.id);
const tabElements = () => [...(scroller.value?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])];
const tabElement = (id: string) => tabElements().find((el) => el.dataset.tabId === id);

// ── Scrolling

function updateEdges() {
  const el = scroller.value;
  if (!el) return;
  canScrollBack.value = el.scrollLeft > 1;
  canScrollForward.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function onWheel(event: WheelEvent) {
  const el = scroller.value;
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  el.scrollLeft += event.deltaY;
}

useResizeObserver(scroller, updateEdges);
watch(() => props.tabs.map((tab) => tab.id + tab.label).join("\n"), () => nextTick(updateEdges), { flush: "post" });
watch(() => props.modelValue, (id) => id && nextTick(() => tabElement(id)?.scrollIntoView?.({ block: "nearest", inline: "nearest" })));

const mask = () =>
  `linear-gradient(to right, ${canScrollBack.value ? "transparent" : "#000"}, #000 1.5rem, #000 calc(100% - 1.5rem), ${canScrollForward.value ? "transparent" : "#000"})`;

// ── Closing

function close(id: string) {
  const tab = props.tabs.find((other) => other.id === id);
  if (!tab?.closable) return;
  if (id === props.modelValue) {
    const next = neighbourAfterClose(ids(), id);
    if (next) emit("update:modelValue", next);
  }
  emit("close", id);
}

function onAuxClick(event: MouseEvent, id: string) {
  if (event.button !== 1) return;
  event.preventDefault();
  close(id);
}

function onMouseDown(event: MouseEvent) {
  // A middle press would start the browser's autoscroll.
  if (event.button === 1) event.preventDefault();
}

// ── Renaming

const renaming = ref<{ id: string; text: string } | null>(null);
const renameProblem = ref("");

function startRename(id: string) {
  const tab = props.tabs.find((other) => other.id === id);
  if (!tab?.renamable || renaming.value) return;
  renaming.value = { id, text: tab.label };
  renameProblem.value = "";
  nextTick(() => {
    const input = scroller.value?.querySelector<HTMLInputElement>("[data-tab-rename]");
    input?.focus();
    input?.select();
  });
}

function stopRename(refocus: boolean) {
  const id = renaming.value?.id;
  renaming.value = null;
  renameProblem.value = "";
  if (refocus && id) nextTick(() => tabElement(id)?.focus());
}

function finishRename(keep: boolean, refocus: boolean) {
  const current = renaming.value;
  if (!current) return;
  if (!keep) return stopRename(refocus);
  const result = checkRename(props.tabs.find((tab) => tab.id === current.id)?.label ?? "", current.text, props.maxLength);
  if (result.kind === "invalid") {
    // Enter on a wrong name keeps the field open; leaving the field gives the change up.
    if (refocus) renameProblem.value = result.problem === "empty" ? uiText.value.nameEmpty : uiText.value.nameTooLong.replace("{max}", String(props.maxLength));
    else stopRename(false);
    return;
  }
  stopRename(refocus);
  if (result.kind === "rename") emit("rename", current.id, result.label);
}

// ── Keyboard

function onKeyDown(event: KeyboardEvent, id: string) {
  if (event.target !== event.currentTarget) return;
  const tab = props.tabs.find((other) => other.id === id);
  if (!tab) return;
  if ((event.key === "Delete" || event.key === "Backspace") && tab.closable) {
    event.preventDefault();
    close(id);
  } else if (event.key === "F2" && tab.renamable) {
    event.preventDefault();
    startRename(id);
  } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    const next = stepTab(ids(), id, event.key === "ArrowLeft" ? -1 : 1);
    if (next.join("\n") !== ids().join("\n")) {
      emit("reorder", next);
      nextTick(() => tabElement(id)?.focus());
    }
  }
}

// ── Dragging

const dragId = ref<string | null>(null);
const drop = ref<{ target: string; after: boolean } | null>(null);
let press: { id: string; x: number } | null = null;
let swallowClick = false;
const DRAG_DISTANCE = 4;

function places() {
  return tabElements().map((el) => {
    const box = el.getBoundingClientRect();
    return { id: el.dataset.tabId!, left: box.left, right: box.right };
  });
}

function onPointerDown(event: PointerEvent, id: string) {
  if (event.button !== 0 || props.tabs.length < 2 || renaming.value) return;
  if ((event.target as HTMLElement).closest("[data-tab-close]")) return;
  press = { id, x: event.clientX };
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", onDragKey, true);
}

function onPointerMove(event: PointerEvent) {
  if (!press) return;
  if (!dragId.value) {
    if (Math.abs(event.clientX - press.x) < DRAG_DISTANCE) return;
    dragId.value = press.id;
  }
  const el = scroller.value;
  if (el) {
    const box = el.getBoundingClientRect();
    if (event.clientX < box.left + 24) el.scrollLeft -= 12;
    else if (event.clientX > box.right - 24) el.scrollLeft += 12;
  }
  const place = dropPlace(places(), event.clientX);
  // No line where the drop would change nothing.
  drop.value = place && moveTab(ids(), dragId.value, place.target, place.after).join("\n") !== ids().join("\n") ? place : null;
}

function endDrag() {
  document.removeEventListener("pointermove", onPointerMove);
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", endDrag);
  document.removeEventListener("keydown", onDragKey, true);
  if (dragId.value) {
    // The click that follows a drag must not count as a click on the tab.
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
  }
  press = null;
  dragId.value = null;
  drop.value = null;
}

function onPointerUp() {
  const id = dragId.value;
  const place = drop.value;
  endDrag();
  if (id && place) emit("reorder", moveTab(ids(), id, place.target, place.after));
}

function onDragKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  endDrag();
}

function onClickCapture(event: MouseEvent) {
  if (!swallowClick) return;
  event.stopPropagation();
  event.preventDefault();
}

onBeforeUnmount(endDrag);
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    data-slot="tab-strip"
    :class="cn('after:bg-border relative flex h-8 items-stretch after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px', props.class)"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <div
      ref="scroller"
      class="relative z-10 min-w-0 flex-initial overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      :style="{ maskImage: mask(), WebkitMaskImage: mask() }"
      data-testid="tab-strip-scroller"
      @wheel="onWheel"
      @scroll.passive="updateEdges"
    >
      <TabsList class="h-full w-max border-b-0" :aria-label="ariaLabel">
        <template v-for="tab in tabs" :key="tab.id">
          <div v-if="renaming?.id === tab.id" class="flex h-full items-center gap-1 px-1">
            <span v-if="$slots.icon" class="flex flex-none items-center empty:hidden" data-testid="strip-tab-icon"><slot name="icon" :tab="tab" /></span>
            <Input
              v-model="renaming.text"
              class="h-6 w-36 px-1.5 text-sm md:text-sm"
              :aria-label="uiText.renameTab"
              :aria-invalid="!!renameProblem || undefined"
              :title="renameProblem || undefined"
              autocomplete="off"
              data-tab-rename
              data-testid="tab-rename-input"
              @update:model-value="renameProblem = ''"
              @keydown.enter.prevent="finishRename(true, true)"
              @keydown.esc.prevent.stop="finishRename(false, true)"
              @blur="finishRename(true, false)"
            />
          </div>
          <TabsTrigger
            v-else
            :value="tab.id"
            :class="cn('group mb-0 max-w-56 select-none gap-1', dragId === tab.id && 'opacity-50', drop?.target === tab.id && (drop.after ? 'shadow-[inset_-2px_0_0_var(--primary)]' : 'shadow-[inset_2px_0_0_var(--primary)]'))"
            :data-tab-id="tab.id"
            :data-drop="drop?.target === tab.id ? (drop.after ? 'after' : 'before') : undefined"
            data-testid="strip-tab"
            @pointerdown="onPointerDown($event, tab.id)"
            @mousedown="onMouseDown"
            @auxclick="onAuxClick($event, tab.id)"
            @click.capture="onClickCapture"
            @dblclick="startRename(tab.id)"
            @keydown="onKeyDown($event, tab.id)"
          >
            <span v-if="$slots.icon" class="flex flex-none items-center empty:hidden" data-testid="strip-tab-icon"><slot name="icon" :tab="tab" /></span>
            <span class="truncate" :title="tab.label">{{ tab.label }}</span>
            <!-- Not a button: the tab is one already. Delete or a middle click close it from the keyboard or mouse. -->
            <span
              v-if="tab.closable"
              role="button"
              tabindex="-1"
              class="text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 flex-none items-center justify-center rounded-sm"
              :aria-label="uiText.closeTab"
              :title="uiText.closeTab"
              data-tab-close
              data-testid="strip-tab-close"
              @mousedown.prevent.stop
              @dblclick.stop
              @click.stop="close(tab.id)"
            >
              <X class="size-3.5" :stroke-width="1.5" />
            </span>
          </TabsTrigger>
        </template>
      </TabsList>
    </div>
    <div v-if="$slots.add" class="relative z-10 flex flex-none items-center pl-1" data-testid="tab-strip-add">
      <slot name="add" />
    </div>
  </TabsRoot>
</template>
