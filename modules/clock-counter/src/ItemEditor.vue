<script setup lang="ts">
// An item's settings, in Tavora's settings layout (the kit's ModuleSettings): what the panel shows (how it counts, hotkeys), then
// Overlays: what the overlay says and how it looks (with a live preview, the same in game and on stream), and where it shows (in game, on stream). Tavora shows them as a dialog over the workspace
// and names it after the item; every change saves at once. Text and number fields save when they lose focus or on Enter, not on
// every key, and whatever is still typed saves when the page changes or this goes away.
import { Hash, Hourglass, Keyboard, Link, Paintbrush, Plus, Timer, Trash2, Type, X } from "@lucide/vue";
import { errorMessage, SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ModuleSettings, SettingsMainBar, SettingsPage, SettingsPreview, SettingsRow, SettingsSection, settingsMenu } from "@tavora/official-ui/components/ui/module-settings";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { TemplateInput } from "@tavora/official-ui/components/ui/template-input";
import { TavoraError } from "@tavora/sdk";
import { computed, inject, onBeforeUnmount, reactive, ref, useTemplateRef, watch, type Ref } from "vue";
import { t } from "./i18n";
import {
  ALIGNS,
  COLORS,
  defaultLook,
  defaultStored,
  find,
  FONTS,
  groupOf,
  groupOverlayState,
  itemText,
  MAX,
  memberNames,
  overlayState,
  placeholderOf,
  setStream,
  SIZES,
  type Align,
  type Clock,
  type Counter,
  type Font,
  type Item,
  type ItemList,
  type OverlayLook,
  type OverlayState,
  type Size,
} from "./items";
import OverlayPreview from "./OverlayPreview.vue";
import { ACTIONS, PANEL } from "./panel";
import { counterName } from "./store";
import { cleanName, compile, compileItem, display, hasWords, keys } from "./template";
import { DEFAULT_FORMAT, FORMAT_PRESETS, formatSeconds, isFormat, MAX_FORMAT } from "./time";

const props = defineProps<{
  item: Item;
  /** What the frame of the dialog says; the page says it itself when Tavora can't (`titled` is false). */
  title: string;
  titled?: boolean | null;
  /** The page to open on, and a count that changes when it is asked for again. */
  start: "item" | "text";
  startCount: number;
}>();
const panel = inject(PANEL)!;
const id = computed(() => props.item.id);
const prefix = computed(() => `cc-${props.item.id}`);

// ── Pages ────────────────────────────────────────────────────────────

type PageId = "item" | "hotkeys" | "text" | "look" | "game" | "stream";
const current = ref<PageId>(props.start);
watch(() => props.startCount, () => (current.value = props.start));
/** When something was last saved, for the footer's "Saved". */
const savedAt = ref<number>();

const kindIcon = computed(() => (props.item.kind === "countdown" ? Hourglass : props.item.kind === "stopwatch" ? Timer : Hash));
const overlayOn = computed(() => panel.overGame.value.has(panel.keyOf(props.item)));
/** Stream overlays are allowed (the first Copy OBS link asks). */
const streamOn = computed(() => panel.store.overlays.value);
const itemPage = computed(() => t(props.item.kind === "counter" ? "edit.page.counter" : "edit.page.clock"));
const groups = computed(() =>
  settingsMenu({
    pages: [
      { id: "item", label: itemPage.value, icon: kindIcon.value, testid: "page-item" },
      { id: "hotkeys", label: t("edit.page.hotkeys"), icon: Keyboard, testid: "page-hotkeys" },
    ],
    look: [
      { id: "text", label: t("edit.page.text"), icon: Type, testid: "page-text" },
      { id: "look", label: t("edit.page.look"), icon: Paintbrush, testid: "page-look" },
    ],
    inGame: { id: "game", on: overlayOn.value, testid: "page-game" },
    onStream: { id: "stream", on: streamOn.value, testid: "page-stream" },
  }),
);

// The page picked takes the old one's place; whatever is typed on the old one saves first.
watch(current, saveFields, { flush: "pre" });

const COLOR_NAMES = ["white", "yellow", "orange", "red", "pink", "violet", "blue", "teal", "green", "black"] as const;
const colorLabels = computed(() => COLOR_NAMES.map((name) => t(`color.${name}`)));
/** Segments that share the control column evenly. */
const fill = "w-full min-w-0 [&>*]:flex-1 [&>*]:px-0";

function change(touched: string[], apply: (data: ItemList) => void): void {
  savedAt.value = Date.now();
  void panel.store.apply(touched, apply);
}

function update(apply: (item: Item) => void): void {
  change([id.value], (data) => {
    const item = find(data, id.value);
    if (item) apply(item);
  });
}

const updateClock = (apply: (clock: Clock) => void) => update((item) => item.kind !== "counter" && apply(item));
const updateCounter = (apply: (counter: Counter) => void) => update((item) => item.kind === "counter" && apply(item));

// ── A linked group's overlay: its look and its text are the group's once it shows as a whole ──

const group = computed(() => (props.item.kind === "counter" ? groupOf(panel.store.list.value, id.value) : null));
const whole = computed(() => !!group.value?.stream.whole);
const members = computed(() => (group.value ? memberNames(group.value, counterName) : []));
/** The look the overlay pages edit: the group's once it shows as a whole. */
const look = computed<OverlayLook>(() => (whole.value ? group.value!.stream.look : props.item.look));

function updateLook(apply: (look: OverlayLook) => void) {
  change([id.value], (data) => {
    const found = groupOf(data, id.value);
    if (found?.stream.whole) {
      const next = structuredClone(found.stream.look);
      apply(next);
      setStream(data, id.value, { look: next });
    } else {
      const item = find(data, id.value);
      if (item) apply(item.look);
    }
  });
}

const scope = computed({
  get: () => (whole.value ? "group" : "self"),
  set: (next: string) => change([id.value], (data) => setStream(data, id.value, { whole: next === "group" })),
});

// ── Overlay text ─────────────────────────────────────────────────────

/** The one placeholder of a clock or counter. */
const placeholder = computed(() => placeholderOf(props.item.kind));
/** The text now in use, as it is saved: the group's, the item's own, or what the item wrote before there was a text field. */
const storedText = computed(() => (whole.value ? group.value!.stream.text || defaultStored(members.value) : itemText(props.item)));
const shownText = () => (whole.value ? display(storedText.value, members.value) : storedText.value);
const text = ref(shownText());
const textFocused = ref(false);
const compiled = computed(() => (whole.value ? compile(text.value, members.value) : compileItem(text.value, placeholder.value)));

/** A placeholder as it is written in the text. */
const braced = (key: string) => `{${key}}`;

/** What each chip adds: a counter's short key (with its full name on hover), or the one placeholder of a clock or counter. */
const chips = computed(() => {
  if (!whole.value) return [{ key: placeholder.value, name: braced(placeholder.value) }];
  const written = keys(members.value);
  return members.value.map((member) => ({ key: written.get(member.id)!, name: cleanName(member.name) }));
});
const known = computed(() => (whole.value ? [...members.value.map((member) => cleanName(member.name)), ...chips.value.map((chip) => chip.key)] : [placeholder.value]));
const ideas = computed(() => {
  if (whole.value) return [display(defaultStored(members.value), members.value), chips.value.map((chip) => braced(chip.key)).join(" / ")];
  const kind = props.item.kind === "counter" ? "count" : "time";
  return ([1, 2, 3, 4] as const).map((number) => t(`edit.idea.${kind}.${number}`));
});
const problem = computed(() => {
  const result = compiled.value;
  if (result.ok) return null;
  const names = chips.value.map((chip) => braced(chip.key)).join(", ");
  return t(result.error === "unknown" && !whole.value ? "edit.problem.unknownItem" : `edit.problem.${result.error}`, { name: result.error === "unknown" ? (result.name ?? "") : "", names });
});

// Another panel (or a rename) changed it: show the new text, unless it is being typed in.
watch([storedText, members, whole], () => {
  if (!textFocused.value) text.value = shownText();
});

/** Saves the text when it is usable; a broken one stays in the field and the overlay keeps the last good one. */
function saveText() {
  const result = compiled.value;
  if (!result.ok || result.stored === storedText.value) return;
  const stored = result.stored;
  if (whole.value) change([id.value], (data) => setStream(data, id.value, { text: stored }));
  // `showLabel` stays in step (does the text have words?) for a version that has no text field.
  else
    update((item) => {
      item.look.text = stored;
      item.look.showLabel = hasWords(stored);
    });
}

const textField = useTemplateRef<{ insert: (value: string) => Promise<void> }>("textField");

function leaveText() {
  textFocused.value = false;
  saveText();
}

function useIdea(idea: string) {
  text.value = idea;
  saveText();
}

/** What the overlay shows now, with the text as it is typed (when it is usable): the preview of both overlay pages. */
const previewState = computed<OverlayState>(() => {
  const result = compiled.value;
  if (whole.value) {
    const found = group.value!;
    return groupOverlayState({ ...found, stream: { ...found.stream, text: result.ok ? result.stored : found.stream.text } }, counterName);
  }
  const state = overlayState(props.item);
  return result.ok && state.kind !== "group" ? { ...state, text: result.stored } : state;
});

// ── Overlay look ─────────────────────────────────────────────────────

const font = computed({ get: () => look.value.font, set: (next: Font) => updateLook((value) => (value.font = next)) });
const align = computed({ get: () => look.value.align, set: (next: Align) => updateLook((value) => (value.align = next)) });
const wordsColor = computed({ get: () => look.value.wordsColor ?? look.value.color, set: (next: string) => updateLook((value) => (value.wordsColor = next)) });
const numberColor = computed({ get: () => look.value.color, set: (next: string) => updateLook((value) => (value.color = next)) });
const wordsSize = computed({ get: () => look.value.wordsSize, set: (next: Size) => updateLook((value) => (value.wordsSize = next)) });
const numberSize = computed({ get: () => look.value.numberSize, set: (next: Size) => updateLook((value) => (value.numberSize = next)) });
const sizeOptions = (kind: string) => SIZES.map((value) => ({ value, label: value.toUpperCase(), testid: `${kind}-size-${value}` }));

// ── Fields that save when they lose focus ────────────────────────────

const label = ref(props.item.label);
const format = ref(props.item.kind === "counter" ? "" : props.item.format);
const doneText = ref(props.item.kind === "countdown" ? props.item.doneText : "");
const step = ref(props.item.kind === "counter" ? String(props.item.step) : "1");
const goal = ref(props.item.kind === "counter" && props.item.goal !== null ? String(props.item.goal) : "");
const duration = ref(splitDuration(props.item.kind === "countdown" ? props.item.duration : 0));

// Another panel changed the item: show its values, unless this field is being typed in.
watch(
  () => props.item,
  (item) => {
    const focused = document.activeElement?.id ?? "";
    const keep = (field: string) => focused === `${prefix.value}-${field}`;
    if (!keep("label")) label.value = item.label;
    if (item.kind !== "counter" && !keep("format")) format.value = item.format;
    if (item.kind === "countdown") {
      if (!keep("done")) doneText.value = item.doneText;
      if (!["h", "m", "s"].some(keep)) duration.value = splitDuration(item.duration);
    }
    if (item.kind === "counter") {
      if (!keep("step")) step.value = String(item.step);
      if (!keep("goal")) goal.value = item.goal === null ? "" : String(item.goal);
    }
  },
);

function splitDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return { h: String(Math.floor(seconds / 3600)), m: String(Math.floor((seconds % 3600) / 60)), s: String(seconds % 60) };
}

const number = (value: string, fallback: number) => (/^-?\d+$/.test(value.trim()) ? Number(value.trim()) : fallback);

function saveLabel() {
  const next = label.value.trim().slice(0, MAX.label);
  if (next !== props.item.label) update((item) => (item.label = next));
}

const formatValid = computed(() => isFormat(format.value));
const sample = 4 * 3600 + 5 * 60 + 9;

function saveFormat(next = format.value) {
  format.value = next;
  if (isFormat(next) && props.item.kind !== "counter" && next !== props.item.format) updateClock((clock) => (clock.format = next));
}

function saveDuration() {
  const ms = (number(duration.value.h, 0) * 3600 + number(duration.value.m, 0) * 60 + number(duration.value.s, 0)) * 1000;
  const next = Math.min(MAX.durationMs, Math.max(1000, ms));
  duration.value = splitDuration(next);
  if (props.item.kind === "countdown" && next !== props.item.duration) updateClock((clock) => (clock.duration = next));
}

function saveDoneText() {
  const next = doneText.value.trim().slice(0, MAX.doneText);
  if (props.item.kind === "countdown" && next !== props.item.doneText) updateClock((clock) => (clock.doneText = next));
}

function saveStep() {
  const next = Math.min(MAX.value, Math.max(1, number(step.value, 1)));
  step.value = String(next);
  if (props.item.kind === "counter" && next !== props.item.step) updateCounter((counter) => (counter.step = next));
}

function saveGoal() {
  const next = goal.value.trim() === "" ? null : Math.min(MAX.value, Math.max(1, number(goal.value, 1)));
  goal.value = next === null ? "" : String(next);
  if (props.item.kind === "counter" && next !== props.item.goal) updateCounter((counter) => (counter.goal = next));
}

// ── Linked counters ──────────────────────────────────────────────────

const counters = computed(() => panel.store.list.value.items.filter((item): item is Counter => item.kind === "counter" && item.id !== id.value));
const links = computed(() =>
  props.item.kind === "counter"
    ? props.item.links.map((link) => ({ ...link, label: counters.value.find((counter) => counter.id === link.target)?.label || t("kind.counter") }))
    : [],
);
const unlinked = computed(() => (props.item.kind === "counter" ? counters.value.filter((counter) => !(props.item as Counter).links.some((link) => link.target === counter.id)) : []));

/** Links this counter to another: the counter picked from the menu. */
function addLink(picked: string) {
  updateCounter((counter) => counter.links.length < MAX.links && !counter.links.some((link) => link.target === picked) && counter.links.push({ target: picked, amount: 1 }));
}

/** What is typed in a link's amount field and not saved yet, by target. */
const amountDrafts = reactive<Record<string, string>>({});

function saveLinkAmount(target: string) {
  const draft = amountDrafts[target];
  if (draft === undefined) return;
  delete amountDrafts[target];
  const amount = Math.min(MAX.value, Math.max(-MAX.value, number(draft, 1))) || 1;
  updateCounter((counter) => {
    const link = counter.links.find((item) => item.target === target);
    if (link && link.amount !== amount) link.amount = amount;
  });
}

const removeLink = (target: string) => updateCounter((counter) => (counter.links = counter.links.filter((link) => link.target !== target)));

// ── On stream ────────────────────────────────────────────────────────

const linkNote = ref<string | null>(null);

/**
 * Runs a call Tavora may refuse and tells the user what to do instead of failing without a word. A panel over the game
 * can't open Tavora's dialogs and windows (the key dialog, the link consent, the preview): Tavora refuses with PERMISSION_DENIED.
 */
async function attempt(note: Ref<string | null>, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (reason) {
    console.warn("[clock-counter]", errorMessage(reason));
    note.value = reason instanceof TavoraError && reason.code === "PERMISSION_DENIED" ? t("edit.bringBack") : t("edit.failed");
  }
}

function copyLink() {
  return attempt(linkNote, async () => {
    const result = await panel.copyLink(props.item);
    linkNote.value = t(result === "copied" ? "edit.copied" : result === "off" ? "edit.overlaysOff" : "edit.noOverlay");
  });
}

function previewOverlay() {
  return attempt(linkNote, () => panel.preview(props.item));
}

const arrangeNote = ref<string | null>(null);

/** Opens Tavora's Overlay page, where the user adds the overlay to the game and moves it; the settings close behind it. */
function arrange() {
  arrangeNote.value = null;
  return attempt(arrangeNote, () => panel.arrange());
}

function resetLink() {
  return attempt(linkNote, async () => {
    await panel.resetLink(props.item);
    linkNote.value = t("edit.resetLinkDone");
  });
}

// ── Hotkeys ──────────────────────────────────────────────────────────

const actions = computed(() => ACTIONS[props.item.kind].filter((action) => action !== "lap" || (props.item.kind === "stopwatch" && props.item.laps)));
const hasKey = (action: string) => panel.hotkeys.value.has(`${action}:${id.value}`);
const hotkeyNote = ref<string | null>(null);

function setKey(action: string) {
  hotkeyNote.value = null;
  return attempt(hotkeyNote, () => panel.setHotkey(action, props.item));
}

// ── Reset this page ──────────────────────────────────────────────────

/** Puts the open page's settings back to their defaults and returns what undoes it. Names, times, counts and links are not settings to reset. */
function reset(page: string): () => void {
  if (page === "item") {
    const item = props.item;
    if (item.kind === "counter") {
      const before = { step: item.step, goal: item.goal, negative: item.negative };
      updateCounter((counter) => Object.assign(counter, { step: 1, goal: null, negative: false }));
      return () => updateCounter((counter) => Object.assign(counter, before));
    }
    const before = { format: item.format, repeat: item.repeat, doneText: item.doneText, laps: item.laps, showLastLap: item.showLastLap };
    updateClock((clock) => Object.assign(clock, { format: DEFAULT_FORMAT, repeat: false, doneText: "", laps: false, showLastLap: false }));
    return () => updateClock((clock) => Object.assign(clock, before));
  }
  if (page === "text") {
    if (whole.value) {
      const before = group.value!.stream.text;
      change([id.value], (data) => setStream(data, id.value, { text: "" }));
      return () => change([id.value], (data) => setStream(data, id.value, { text: before }));
    }
    const before = { text: props.item.look.text, showLabel: props.item.look.showLabel };
    update((item) => {
      delete item.look.text;
      item.look.showLabel = true;
    });
    return () =>
      update((item) => {
        if (before.text === undefined) delete item.look.text;
        else item.look.text = before.text;
        item.look.showLabel = before.showLabel;
      });
  }
  const before = { ...look.value };
  const defaults = defaultLook();
  const put = (value: OverlayLook, from: OverlayLook) => {
    Object.assign(value, { font: from.font, align: from.align, outline: from.outline, color: from.color, wordsSize: from.wordsSize, numberSize: from.numberSize });
    if (from.wordsColor === undefined) delete value.wordsColor;
    else value.wordsColor = from.wordsColor;
  };
  updateLook((value) => put(value, defaults));
  return () => updateLook((value) => put(value, before));
}

// ── Closing ──────────────────────────────────────────────────────────

/** Saves what is still typed in the open page's fields, even if the browser never sends their blur (the page changes, the dialog goes). */
function saveFields() {
  saveLabel();
  saveText();
  if (props.item.kind !== "counter" && isFormat(format.value)) saveFormat();
  if (props.item.kind === "countdown") {
    saveDuration();
    saveDoneText();
  }
  if (props.item.kind === "counter") {
    saveStep();
    saveGoal();
    Object.keys(amountDrafts).forEach(saveLinkAmount);
  }
}

onBeforeUnmount(saveFields);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-sm" :data-testid="`editor-${item.id}`">
    <!-- Tavora's frame names the item when it can (`titled`); an older Tavora can't, and then the page does. -->
    <header v-if="titled === false" class="flex h-12 flex-none items-center border-b px-4">
      <h2 class="min-w-0 truncate text-base font-semibold">{{ title }}</h2>
    </header>

    <div class="min-h-0 flex-1">
      <ModuleSettings v-model:page="current" :groups="groups" :label="t('edit.pages')" :reset="reset" :resettable="(page) => page === 'item' || page === 'text' || page === 'look'" :saved-at="savedAt">
        <!-- How it counts -->
        <SettingsPage v-if="current === 'item'" :title="itemPage" :description="t(item.kind === 'counter' ? 'edit.about.counter' : 'edit.about.clock')">
          <SettingsSection>
            <SettingsRow :label="t('edit.name')">
              <Input :id="`${prefix}-label`" v-model="label" class="w-full" :maxlength="MAX.label" :placeholder="t(`kind.${item.kind}`)" :aria-label="t('edit.name')" @blur="saveLabel" @keydown.enter="saveLabel" />
            </SettingsRow>

            <template v-if="item.kind !== 'counter'">
              <SettingsRow :label="t('edit.format')" :hint="formatValid ? t('edit.formatHint', { text: formatSeconds(sample, format) }) : undefined">
                <div class="flex w-full gap-1">
                  <Input :id="`${prefix}-format`" v-model="format" class="min-w-0 flex-1 font-mono" :maxlength="MAX_FORMAT" :aria-label="t('edit.format')" :aria-invalid="!formatValid" :title="t('edit.formatHelp')" @blur="saveFormat()" @keydown.enter="saveFormat()" />
                  <!-- Kit menus, not ui.showMenu: Tavora draws no module menu while the panel is a dialog over the workspace. -->
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="secondary" size="sm" class="h-8" :aria-label="t('edit.formatPresets')" :title="t('edit.formatPresets')" data-testid="format-presets">···</Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuRadioGroup :model-value="format" @update:model-value="(preset) => saveFormat(String(preset))">
                        <DropdownMenuRadioItem v-for="preset in FORMAT_PRESETS" :key="preset" :value="preset" class="tabular-nums">{{ preset }} · {{ formatSeconds(sample, preset) }}</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p v-if="!formatValid" class="text-destructive w-full text-xs" role="alert">{{ t("edit.formatInvalid") }}</p>
              </SettingsRow>

              <template v-if="item.kind === 'countdown'">
                <SettingsRow :label="t('edit.duration')">
                  <div class="flex items-center gap-1">
                    <Input :id="`${prefix}-h`" v-model="duration.h" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="2" :aria-label="t('edit.hours')" @blur="saveDuration" @keydown.enter="saveDuration" />
                    <span aria-hidden="true">:</span>
                    <Input :id="`${prefix}-m`" v-model="duration.m" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="3" :aria-label="t('edit.minutes')" @blur="saveDuration" @keydown.enter="saveDuration" />
                    <span aria-hidden="true">:</span>
                    <Input :id="`${prefix}-s`" v-model="duration.s" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="4" :aria-label="t('edit.seconds')" @blur="saveDuration" @keydown.enter="saveDuration" />
                  </div>
                </SettingsRow>
                <SettingsRow :label="t('edit.repeat')">
                  <Switch :model-value="item.repeat" :aria-label="t('edit.repeat')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.repeat = on))" />
                </SettingsRow>
                <SettingsRow v-if="!item.repeat" :label="t('edit.doneText')" :hint="t('edit.doneTextHint')">
                  <Input :id="`${prefix}-done`" v-model="doneText" class="w-full" :maxlength="MAX.doneText" :placeholder="t('item.done')" :aria-label="t('edit.doneText')" @blur="saveDoneText" @keydown.enter="saveDoneText" />
                </SettingsRow>
              </template>

              <template v-else>
                <SettingsRow :label="t('edit.laps')">
                  <Switch :model-value="item.laps" :aria-label="t('edit.laps')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.laps = on))" />
                </SettingsRow>
                <SettingsRow v-if="item.laps" :label="t('edit.lastLap')">
                  <Switch :model-value="item.showLastLap" :aria-label="t('edit.lastLap')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.showLastLap = on))" />
                </SettingsRow>
              </template>
            </template>

            <template v-else>
              <SettingsRow :label="t('edit.step')">
                <Input :id="`${prefix}-step`" v-model="step" class="w-24 tabular-nums" inputmode="numeric" :aria-label="t('edit.step')" @blur="saveStep" @keydown.enter="saveStep" />
              </SettingsRow>
              <SettingsRow :label="t('edit.goal')" :hint="t('edit.goalHint')">
                <Input :id="`${prefix}-goal`" v-model="goal" class="w-24 tabular-nums" inputmode="numeric" :aria-label="t('edit.goal')" @blur="saveGoal" @keydown.enter="saveGoal" />
              </SettingsRow>
              <SettingsRow :label="t('edit.negative')">
                <Switch :model-value="item.negative" :aria-label="t('edit.negative')" @update:model-value="(on: boolean) => updateCounter((counter) => (counter.negative = on))" />
              </SettingsRow>
              <SettingsRow :label="t('edit.links')" :hint="t('edit.linksHint')">
                <DropdownMenu v-if="unlinked.length && item.links.length < MAX.links">
                  <DropdownMenuTrigger as-child>
                    <Button variant="secondary" size="sm" data-testid="link-add"><Plus :stroke-width="1.5" /> {{ t("edit.linkAdd") }}</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>{{ t("edit.linkPick") }}</DropdownMenuLabel>
                    <DropdownMenuItem v-for="counter in unlinked" :key="counter.id" :data-testid="`link-pick-${counter.id}`" @select="addLink(counter.id)">{{ counter.label || t("kind.counter") }}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SettingsRow>
              <SettingsRow v-for="link in links" :key="link.target" :label="link.label">
                <Input
                  :model-value="amountDrafts[link.target] ?? String(link.amount)"
                  class="w-20 tabular-nums"
                  inputmode="numeric"
                  :aria-label="t('edit.linkAmount', { label: link.label })"
                  @update:model-value="(value: string | number) => (amountDrafts[link.target] = String(value))"
                  @blur="saveLinkAmount(link.target)"
                  @keydown.enter="saveLinkAmount(link.target)"
                />
                <Link class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" aria-hidden="true" />
                <Button variant="ghost" size="icon-sm" :aria-label="t('edit.linkRemove', { label: link.label })" :title="t('edit.linkRemove', { label: link.label })" @click="removeLink(link.target)">
                  <X :stroke-width="1.5" />
                </Button>
              </SettingsRow>
            </template>
          </SettingsSection>

          <SettingsSection>
            <SettingsRow :label="t('edit.delete')" :hint="t('edit.deleteHint')" danger>
              <Button variant="destructive" size="sm" :data-testid="`delete-${item.id}`" @click="panel.remove(item)"><Trash2 :stroke-width="1.5" />{{ t("edit.delete") }}</Button>
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>

        <!-- Hotkeys -->
        <SettingsPage v-else-if="current === 'hotkeys'" :title="t('edit.page.hotkeys')" :description="t('edit.about.hotkeys')">
          <SettingsSection>
            <SettingsRow v-for="action in actions" :key="action" :label="t(`action.${action}`)">
              <span class="text-muted-foreground text-xs" :data-testid="`hotkey-${action}-${item.id}`">{{ hasKey(action) ? t("edit.hotkeyOn") : t("edit.hotkeyNone") }}</span>
              <Button variant="secondary" size="sm" :aria-label="`${t(`action.${action}`)}: ${hasKey(action) ? t('edit.hotkeyChange') : t('edit.hotkeySet')}`" @click="setKey(action)">{{ hasKey(action) ? t("edit.hotkeyChange") : t("edit.hotkeySet") }}</Button>
            </SettingsRow>
            <p class="text-muted-foreground pt-3 text-xs">{{ t("edit.hotkeysHint") }}</p>
            <p v-if="hotkeyNote" class="text-muted-foreground pt-2 text-xs" role="status" data-testid="hotkey-note">{{ hotkeyNote }}</p>
          </SettingsSection>
        </SettingsPage>

        <!-- Overlay: what it says -->
        <SettingsPage v-else-if="current === 'text'" :title="t('edit.title.text')" :description="t('edit.about.text')">
          <template #preview>
            <SettingsPreview :label="t('edit.overlayPreview')"><OverlayPreview :state="previewState" /></SettingsPreview>
          </template>
          <SettingsSection>
            <SettingsRow v-if="group" :label="t('edit.scope')" :hint="t('edit.scopeHint')">
              <SegmentedControl
                v-model="scope"
                :label="t('edit.scope')"
                :options="[
                  { value: 'self', label: t('edit.scopeSelf'), testid: 'scope-self' },
                  { value: 'group', label: t('edit.scopeGroup'), testid: 'scope-group' },
                ]"
                :class="fill"
              />
            </SettingsRow>
            <SettingsRow :label="t('edit.text')" :hint="t(whole ? 'edit.textHint.group' : item.kind === 'counter' ? 'edit.textHint.count' : 'edit.textHint.time')" stacked>
              <div class="flex w-full flex-col gap-2">
                <TemplateInput
                  ref="textField"
                  v-model="text"
                  :known="known"
                  :maxlength="MAX.text"
                  :invalid="!!problem"
                  :aria-label="t('edit.text')"
                  data-testid="overlay-text"
                  @focusin="textFocused = true"
                  @focusout="leaveText"
                  @keydown.enter="saveText"
                />
                <p v-if="problem" class="text-destructive text-xs" role="alert" data-testid="text-problem">{{ problem }} {{ t("edit.textInvalid") }}</p>
                <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('edit.insert')">
                  <span class="text-muted-foreground mr-1 text-xs">{{ t("edit.insert") }}</span>
                  <Button v-for="chip in chips" :key="chip.key" variant="secondary" size="xs" :aria-label="t('edit.insertThis', { name: chip.name })" :title="t('edit.insertThis', { name: chip.name })" :data-testid="`chip-${chip.key}`" @mousedown.prevent @click="textField?.insert(braced(chip.key))">
                    {{ braced(chip.key) }}
                  </Button>
                </div>
                <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="t('edit.ideas')">
                  <span class="text-muted-foreground mr-1 text-xs">{{ t("edit.ideas") }}</span>
                  <Button v-for="(idea, index) in ideas" :key="index" variant="ghost" size="xs" class="text-muted-foreground" :data-testid="`idea-${index + 1}`" @mousedown.prevent @click="useIdea(idea)">{{ idea }}</Button>
                </div>
              </div>
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>

        <!-- Overlay: how it looks -->
        <SettingsPage v-else-if="current === 'look'" :title="t('edit.title.look')" :description="t('edit.about.look')">
          <template #preview>
            <SettingsPreview :label="t('edit.overlayPreview')"><OverlayPreview :state="previewState" /></SettingsPreview>
          </template>
          <SettingsSection :title="t('edit.all')">
            <SettingsRow :label="t('edit.font')">
              <SegmentedControl v-model="font" :label="t('edit.font')" :options="FONTS.map((value) => ({ value, label: t(`edit.font.${value}`) }))" :class="fill" />
            </SettingsRow>
            <SettingsRow :label="t('edit.align')">
              <SegmentedControl v-model="align" :label="t('edit.align')" :options="ALIGNS.map((value) => ({ value, label: t(`edit.align.${value}`) }))" :class="fill" />
            </SettingsRow>
            <SettingsRow :label="t('edit.outline')">
              <Switch :model-value="look.outline" :aria-label="t('edit.outline')" @update:model-value="(on: boolean) => updateLook((value) => (value.outline = on))" />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection :title="t('edit.words')">
            <SettingsRow :label="t('edit.color')">
              <ColorPicker v-model="wordsColor" :label="t('edit.color')" :colors="[...COLORS]" :labels="colorLabels" :columns="5" data-testid="words-color" />
            </SettingsRow>
            <SettingsRow :label="t('edit.size')">
              <SegmentedControl v-model="wordsSize" :label="`${t('edit.words')}: ${t('edit.size')}`" :options="sizeOptions('words')" :class="fill" />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection :title="t('edit.number')">
            <SettingsRow :label="t('edit.color')">
              <ColorPicker v-model="numberColor" :label="t('edit.color')" :colors="[...COLORS]" :labels="colorLabels" :columns="5" data-testid="number-color" />
            </SettingsRow>
            <SettingsRow :label="t('edit.size')">
              <SegmentedControl v-model="numberSize" :label="`${t('edit.number')}: ${t('edit.size')}`" :options="sizeOptions('number')" :class="fill" />
            </SettingsRow>
          </SettingsSection>
        </SettingsPage>

        <!-- Where it shows: in game -->
        <SettingsPage v-else-if="current === 'game'" :title="t('edit.title.game')" :description="t('edit.about.game')">
          <template #main>
            <SettingsMainBar :label="t(overlayOn ? 'edit.overGame' : 'edit.notOverGame')" :hint="t(overlayOn ? 'edit.gameOn' : 'edit.gameOff')">
              <Button v-if="panel.canArrange" variant="secondary" size="sm" data-testid="arrange" @click="arrange">{{ t("edit.arrange") }}</Button>
            </SettingsMainBar>
          </template>
          <p v-if="arrangeNote" class="text-muted-foreground pt-4 text-xs" role="status" data-testid="arrange-note">{{ arrangeNote }}</p>
        </SettingsPage>

        <!-- Where it shows: on stream -->
        <SettingsPage v-else :title="t('edit.title.stream')" :description="t('edit.about.stream')">
          <template #main>
            <SettingsMainBar :label="t('edit.obsLink')" :hint="t('edit.obsLinkHint')">
              <Button variant="secondary" size="sm" :data-testid="`copy-link-${item.id}`" @click="copyLink">{{ t("edit.copyLink") }}</Button>
              <Button variant="secondary" size="sm" :data-testid="`preview-${item.id}`" @click="previewOverlay">{{ t("edit.previewOverlay") }}</Button>
            </SettingsMainBar>
          </template>
          <SettingsSection>
            <SettingsRow v-if="panel.store.overlays.value" :label="t('edit.resetLink')" :hint="t('edit.resetLinkHint')">
              <Button variant="secondary" size="sm" data-testid="reset-link" @click="resetLink">{{ t("edit.resetLink") }}</Button>
            </SettingsRow>
            <p v-if="linkNote" class="text-muted-foreground pt-3 text-xs" role="status" data-testid="link-note">{{ linkNote }}</p>
          </SettingsSection>
        </SettingsPage>
      </ModuleSettings>
    </div>
  </div>
</template>
