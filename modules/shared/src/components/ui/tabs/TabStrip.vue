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
// - A row that is too wide scrolls with the wheel and fades at the edges. The open tab stays in view when the row gets
//   narrower. The tabs that don't fit are reached as the user picked under Settings > Appearance > Too many tabs, like
//   Tavora's own panel tabs: a list button with their count (a menu of them), or ‹ › arrows that open the tab before or
//   after the open one, each shown only on a side that has hidden tabs. The arrows take no Tab stop: the arrow keys
//   already walk the tabs. `overflow` sets one of the two for this strip instead.
// - The `add` slot sits after the row, always visible.
import { computed, nextTick, ref, watch } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "@lucide/vue";
import { TabsRoot } from "reka-ui";
import { Button } from "../button";
import { leaveToolbar } from "../toolbar/context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../dropdown-menu";
import { isComposing } from "../../../lib/keys";
import { cn } from "../../../lib/utils";
import { Input } from "../input";
import { Tooltip, type TooltipRect } from "../../tooltip";
import { uiText } from "../text";
import { DEFAULT_NAME_LIMIT } from "../../name-check";
import TabsList from "./TabsList.vue";
import TabsTrigger from "./TabsTrigger.vue";
import { reducedMotion, useReorderMotion } from "../reorder";
import { bindDrag } from "../../../lib/bind-drag";
import { checkRename, moveTab, neighbourAfterClose, neighbourTab, revealBy, stepTab, tabsOutOfView, type StripTab } from "./tab-strip";
import { tabOverflow, type TabOverflow } from "./tab-overflow";
// Its buttons are parts of it, not stops of a Toolbar around it.
leaveToolbar();

const props = withDefaults(
  defineProps<{
    tabs: StripTab[];
    modelValue?: string;
    maxLength?: number;
    ariaLabel?: string;
    /** How tabs that don't fit are reached; left out, the user's choice (Settings > Appearance > Too many tabs). */
    overflow?: TabOverflow;
    class?: string;
  }>(),
  { maxLength: DEFAULT_NAME_LIMIT, overflow: undefined, ariaLabel: undefined, modelValue: undefined, class: undefined },
);
const emit = defineEmits<{
  "update:modelValue": [id: string];
  close: [id: string];
  reorder: [ids: string[]];
  rename: [id: string, label: string];
}>();

const scroller = ref<HTMLElement | null>(null);
const canScrollBack = ref(false);
const canScrollForward = ref(false);
/** The tabs not entirely in view, in tab order, and the sides they are on. */
const outOfView = ref<{ hidden: string[]; before: boolean; after: boolean }>({ hidden: [], before: false, after: false });
const mode = computed<TabOverflow>(() => props.overflow ?? tabOverflow.value);
const hiddenTabs = computed(() => outOfView.value.hidden.map((id) => props.tabs.find((tab) => tab.id === id)).filter((tab): tab is StripTab => !!tab));
const moreLabel = computed(() => (hiddenTabs.value.length === 1 ? uiText.value.moreTab : uiText.value.moreTabs.replace("{count}", String(hiddenTabs.value.length))));

const ids = () => props.tabs.map((tab) => tab.id);
const tabElements = () => [...(scroller.value?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])];
const tabElement = (id: string) => tabElements().find((el) => el.dataset.tabId === id);

// ── Scrolling and the tabs that don't fit

/**
 * Finds the tabs out of view. With `keepOpen` the open tab is brought into the row first, as when the row got narrower;
 * after the user scrolled the row it stays where they put it.
 */
function measure(keepOpen: boolean) {
  const el = scroller.value;
  if (!el) return;
  const row = el.getBoundingClientRect();
  const open = keepOpen && !dragId.value && props.modelValue !== undefined ? tabElement(props.modelValue) : undefined;
  const by = open ? revealBy(row, open.getBoundingClientRect()) : 0;
  if (by) el.scrollLeft += by;
  canScrollBack.value = el.scrollLeft > 1;
  canScrollForward.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  const next = tabsOutOfView(row, places());
  const now = outOfView.value;
  if (next.hidden.join("\n") !== now.hidden.join("\n") || next.before !== now.before || next.after !== now.after) outOfView.value = next;
}

/** An arrow: opens the tab before or after the open one, and the row follows it. Past the end it brings in the nearest hidden tab. */
function step(by: -1 | 1) {
  const next = neighbourTab(ids(), props.modelValue, by);
  if (next) return emit("update:modelValue", next);
  const el = scroller.value;
  if (!el) return;
  const row = el.getBoundingClientRect();
  const boxes = places();
  const target = by < 0 ? boxes.filter((box) => box.left < row.left - 1).at(-1) : boxes.find((box) => box.right > row.right + 1);
  if (!target) return;
  el.scrollLeft += revealBy(row, target);
  measure(false);
}

function pickHidden(id: string) {
  emit("update:modelValue", id);
  // A tab already open (scrolled away with the wheel) is brought back too.
  nextTick(() => measure(true));
}

function onWheel(event: WheelEvent) {
  const el = scroller.value;
  if (!el || el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  el.scrollLeft += event.deltaY;
}

// The row and the tabs in it: a narrower row, or tabs that got wider (another font), keep the open tab in view.
const tabRow = computed(() => scroller.value?.firstElementChild as HTMLElement | null | undefined);
useResizeObserver([scroller, tabRow], () => measure(true));
// A new order or name only counts again: after a drag the row stays where the tab was dropped.
watch(() => props.tabs.map((tab) => tab.id + tab.label).join("\n"), () => nextTick(() => measure(false)), { flush: "post" });
watch(() => props.modelValue, (id) => id !== undefined && nextTick(() => measure(true)));

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
// The message's card closes on a scroll or resize (it would no longer sit by the field); the field stays marked until the name changes.
const renameTip = ref(false);
// Where a wrong name's message points: the rename field. The strip is one line tall, so the message sits in a tooltip beside it.
const renameAnchor = ref<TooltipRect | undefined>();
const renameTipId = `tab-rename-${Math.random().toString(36).slice(2, 8)}`;

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

/** Enter keeps the new name, unless it only confirms text an input method is still composing. */
function onRenameEnter(event: KeyboardEvent) {
  if (isComposing(event)) return;
  event.preventDefault();
  finishRename(true, true);
}

/** Escape drops the new name, unless it only cancels text an input method is still composing. */
function onRenameEscape(event: KeyboardEvent) {
  if (isComposing(event)) return;
  event.preventDefault();
  event.stopPropagation();
  finishRename(false, true);
}

function finishRename(keep: boolean, refocus: boolean) {
  const current = renaming.value;
  if (!current) return;
  if (!keep) return stopRename(refocus);
  const result = checkRename(props.tabs.find((tab) => tab.id === current.id)?.label ?? "", current.text, props.maxLength);
  if (result.kind === "invalid") {
    // Enter on a wrong name keeps the field open; leaving the field gives the change up.
    if (refocus) {
      renameAnchor.value = scroller.value?.querySelector("[data-tab-rename]")?.getBoundingClientRect();
      renameTip.value = true;
      renameProblem.value = result.problem === "empty" ? uiText.value.nameEmpty : uiText.value.nameTooLong.replace("{max}", String(props.maxLength));
    }
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
/** The tab in the hand lifts and follows the pointer and the others slide aside; under reduced motion the line shows instead. */
const reorder = useReorderMotion(scroller, { axis: "x" });
const lifting = ref(false);
/** A tab moves once the pointer has gone this far sideways, so a click with a shaky hand stays a click. */
const drag = bindDrag({ threshold: 4, axis: "x" });

function places() {
  return tabElements().map((el) => {
    const box = el.getBoundingClientRect();
    return { id: el.dataset.tabId!, left: box.left, right: box.right };
  });
}

function onPointerDown(event: PointerEvent, id: string) {
  if (event.button !== 0 || props.tabs.length < 2 || renaming.value) return;
  if ((event.target as HTMLElement).closest("[data-tab-close]")) return;
  drag.start(event, {
    start() {
      dragId.value = id;
      lifting.value = !reducedMotion();
      reorder.begin(id, { lift: true });
    },
    move(next, delta) {
      reorder.follow(delta.x, 0);
      const el = scroller.value;
      if (el) {
        const box = el.getBoundingClientRect();
        if (next.clientX < box.left + 24) el.scrollLeft -= 12;
        else if (next.clientX > box.right - 24) el.scrollLeft += 12;
      }
      // Judged against the layout at the grab: live boxes include the dragged tab, which sits under the pointer, and the
      // tabs that slid aside. No place where the drop would change nothing.
      const place = reorder.over(next.clientX, next.clientY);
      drop.value = place ? { target: place.id, after: place.after } : null;
    },
    drop() {
      const place = drop.value;
      const moving = lifting.value;
      // With a place to go, the motion carries on into the tab's new place instead of stopping.
      endDrag(!!place);
      if (!place) return;
      const commit = () => emit("reorder", moveTab(ids(), id, place.target, place.after));
      if (moving) void reorder.drop(commit);
      else commit();
    },
    cancel: () => endDrag(false),
  });
}

function endDrag(settled: boolean) {
  if (dragId.value && !settled) reorder.cancel();
  dragId.value = null;
  drop.value = null;
  lifting.value = false;
}
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    data-slot="tab-strip"
    :data-tab-overflow="mode"
    :class="cn('after:bg-border relative flex h-8 items-stretch after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px', props.class)"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <!-- The arrows take no Tab stop and keep the focus where it is: the arrow keys walk the tabs already. -->
    <div v-if="mode === 'arrows' && outOfView.before" class="relative z-10 flex flex-none items-center pr-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        tabindex="-1"
        :aria-label="uiText.previousTab"
        :title="uiText.previousTab"
        data-testid="strip-previous-tab"
        @mousedown.prevent
        @click="step(-1)"
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
    </div>
    <div
      ref="scroller"
      class="relative z-10 min-w-0 flex-initial overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      :style="{ maskImage: mask(), WebkitMaskImage: mask() }"
      data-testid="tab-strip-scroller"
      @wheel="onWheel"
      @scroll.passive="measure(false)"
    >
      <!-- The strip keeps each tab's own line (no sliding one): tabs open, close and move all the time. -->
      <TabsList class="h-full w-max border-b-0" :indicator="false" :aria-label="ariaLabel">
        <template v-for="tab in tabs" :key="tab.id">
          <div v-if="renaming?.id === tab.id" class="flex h-full items-center gap-1 px-1">
            <span v-if="$slots.icon" class="flex flex-none items-center empty:hidden" data-testid="strip-tab-icon"><slot name="icon" :tab="tab" /></span>
            <Input
              v-model="renaming.text"
              class="h-6 w-36 px-1.5 text-sm md:text-sm"
              :aria-label="uiText.renameTab"
              :aria-invalid="!!renameProblem || undefined"
              :aria-describedby="renameProblem ? renameTipId : undefined"
              autocomplete="off"
              data-tab-rename
              data-testid="tab-rename-input"
              @update:model-value="renameProblem = ''"
              @keydown.enter="onRenameEnter"
              @keydown.esc="onRenameEscape"
              @blur="finishRename(true, false)"
            />
          </div>
          <TabsTrigger
            v-else
            :value="tab.id"
            :class="cn('group mb-0 max-w-56 select-none gap-1', dragId === tab.id && !lifting && 'opacity-50', !lifting && drop?.target === tab.id && (drop.after ? 'shadow-[inset_-2px_0_0_var(--primary)]' : 'shadow-[inset_2px_0_0_var(--primary)]'))"
            :data-tab-id="tab.id"
            :data-reorder-id="tab.id"
            :data-drop="drop?.target === tab.id ? (drop.after ? 'after' : 'before') : undefined"
            data-testid="strip-tab"
            @pointerdown="onPointerDown($event, tab.id)"
            @mousedown="onMouseDown"
            @auxclick="onAuxClick($event, tab.id)"
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
              <X class="size-3.5" />
            </span>
          </TabsTrigger>
        </template>
      </TabsList>
    </div>
    <div v-if="mode === 'arrows' && outOfView.after" class="relative z-10 flex flex-none items-center pl-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        tabindex="-1"
        :aria-label="uiText.nextTab"
        :title="uiText.nextTab"
        data-testid="strip-next-tab"
        @mousedown.prevent
        @click="step(1)"
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
    <div v-else-if="mode === 'list' && hiddenTabs.length" class="relative z-10 flex flex-none items-center pl-1">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button type="button" variant="ghost" size="sm" class="gap-0.5 px-1.5 text-xs tabular-nums" :aria-label="moreLabel" :title="moreLabel" data-testid="strip-hidden-tabs">
            <ChevronDown aria-hidden="true" />{{ hiddenTabs.length }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" class="max-w-72 min-w-52" data-testid="strip-hidden-menu">
          <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ moreLabel }}</DropdownMenuLabel>
          <!-- The open tab is in the list when it was scrolled away; the kit marks it as the chosen row. -->
          <DropdownMenuRadioGroup :model-value="modelValue">
            <DropdownMenuRadioItem v-for="tab in hiddenTabs" :key="tab.id" :value="tab.id" class="pl-2" :data-tab-id="tab.id" data-testid="strip-hidden-tab" @select="pickHidden(tab.id)">
              <span v-if="$slots.icon" class="flex flex-none items-center empty:hidden"><slot name="icon" :tab="tab" /></span>
              <span class="min-w-0 truncate">{{ tab.label }}</span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <Tooltip :open="renameTip && !!renameProblem" :anchor="renameAnchor" :title="renameProblem" tone="danger" compact @dismiss="renameTip = false" />
    <span :id="renameTipId" class="sr-only" role="alert">{{ renameProblem }}</span>
    <div v-if="$slots.add" class="relative z-10 flex flex-none items-center pl-1" data-testid="tab-strip-add">
      <slot name="add" />
    </div>
  </TabsRoot>
</template>
