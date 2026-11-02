<script setup lang="ts">
// An item's settings, in pages: how it counts (Clock or Counter), how it looks, its hotkeys and what it does on stream, with
// Delete and Done in one footer. Every change saves at once; text and number fields save when they lose focus or on Enter,
// not on every key, and whatever is still typed saves when the page changes or this goes away. Tavora shows them as a dialog
// over the workspace (`page`: the panel itself is that dialog, so this is its whole page, and `titled` says the dialog's
// frame already names the item); an older Tavora gets ItemCard's dialog in the middle of the panel. The pages are a list on
// the left; on a narrow panel they fold into a dropdown on top, and a row puts its control under its name.
import { Hash, Hourglass, Keyboard, Link, Palette, Plus, Radio, Timer, Trash2, X } from "@lucide/vue";
import { errorMessage, SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton } from "@tavora/official-ui/components/ui/dialog";
import { SettingsRow, SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { usePageMotion } from "@tavora/official-ui/components/ui/motion";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { TavoraError } from "@tavora/sdk";
import { computed, inject, nextTick, onBeforeUnmount, onMounted, reactive, ref, useTemplateRef, watch, type Ref } from "vue";
import { t } from "./i18n";
import { ALIGNS, COLORS, defaultStored, find, FONTS, groupOf, MAX, memberNames, setStream, type Align, type Clock, type Counter, type Font, type Item, type ItemList, type OverlayLook } from "./items";
import { ACTIONS, PANEL } from "./panel";
import { counterName } from "./store";
import { cleanName, compile, display, keys, render } from "./template";
import { FORMAT_PRESETS, formatSeconds, isFormat, MAX_FORMAT } from "./time";

const props = defineProps<{ item: Item; page?: boolean; titled?: boolean | null }>();
const emit = defineEmits<{ close: [] }>();
const panel = inject(PANEL)!;
const id = computed(() => props.item.id);
const name = computed(() => props.item.label || t(`kind.${props.item.kind}`));
const prefix = computed(() => `cc-${props.item.id}`);

// ── Pages, and how much room there is ───────────────────────────────

type PageId = "item" | "look" | "hotkeys" | "stream";
const current = ref<PageId>("item");
const root = useTemplateRef<HTMLElement>("root");
const holder = useTemplateRef<HTMLElement>("holder");
const { play } = usePageMotion(holder);
/** The width the settings have: the pages fold into a dropdown below FOLD, and a row puts its control under its name below STACK. */
const FOLD = 640;
const STACK = 460;
const width = ref(FOLD);
let observer: ResizeObserver | undefined;
onMounted(() => {
  width.value = root.value?.clientWidth ?? FOLD;
  observer = new ResizeObserver(([entry]) => entry && (width.value = entry.contentRect.width));
  if (root.value) observer.observe(root.value);
});
const folded = computed(() => width.value < FOLD);
const stacked = computed(() => width.value < STACK);

const kindIcon = computed(() => (props.item.kind === "countdown" ? Hourglass : props.item.kind === "stopwatch" ? Timer : Hash));
const pages = computed(() => [
  { id: "item" as const, label: t(props.item.kind === "counter" ? "edit.page.counter" : "edit.page.clock"), icon: kindIcon.value, testid: "page-item" },
  { id: "look" as const, label: t("edit.page.look"), icon: Palette, testid: "page-look" },
  { id: "hotkeys" as const, label: t("edit.page.hotkeys"), icon: Keyboard, testid: "page-hotkeys" },
  { id: "stream" as const, label: t("edit.page.stream"), icon: Radio, testid: "page-stream" },
]);
const navGroups = computed<NavGroup[]>(() => [{ items: pages.value }]);
const pageOptions = computed(() => pages.value.map((page) => ({ value: page.id, label: page.label })));
const pageTitle = computed(() => pages.value.find((page) => page.id === current.value)!.label);

// The page picked takes the old one's place; whatever is typed on the old one saves first.
watch(current, saveFields, { flush: "pre" });
watch(current, play, { flush: "post" });

const COLOR_NAMES = ["white", "yellow", "orange", "red", "pink", "violet", "blue", "teal", "green", "black"] as const;

function change(touched: string[], apply: (data: ItemList) => void): void {
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

// ── Linked group on stream ───────────────────────────────────────────

const group = computed(() => (props.item.kind === "counter" ? groupOf(panel.store.list.value, id.value) : null));
const whole = computed(() => !!group.value?.stream.whole);
const members = computed(() => (group.value ? memberNames(group.value, counterName) : []));
/** The look the stream settings below edit: the group's once it shows as a whole. */
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

const effectiveStored = computed(() => group.value?.stream.text || defaultStored(members.value));
const shownText = () => display(effectiveStored.value, members.value);
const groupText = ref(shownText());
const textField = ref<{ $el: HTMLInputElement } | null>(null);
const compiled = computed(() => compile(groupText.value, members.value));
const problem = computed(() => {
  const result = compiled.value;
  if (result.ok) return null;
  const names = [...keys(members.value).values()].map((key) => `{${key}}`).join(", ");
  return t(`edit.problem.${result.error}`, { name: result.error === "unknown" ? (result.name ?? "") : "", names });
});
/** What each chip adds and shows: the counter's short key, with its full name on hover. */
const chips = computed(() => {
  const written = keys(members.value);
  return members.value.map((member) => ({ id: member.id, key: written.get(member.id)!, name: cleanName(member.name) }));
});
const groupPreview = computed(() => {
  if (!compiled.value.ok) return "";
  const values = new Map((group.value?.members ?? []).map((member) => [member.id, String(member.value)]));
  return render(compiled.value.stored, values) ?? "";
});

// Another panel (or a rename) changed it: show the new text, unless it is being typed in.
watch([effectiveStored, members], () => {
  if (document.activeElement?.id !== `${prefix.value}-gtext`) groupText.value = shownText();
});

/** Saves the text when it is usable; a broken one stays in the field and the overlay keeps the last good one. */
function saveGroupText() {
  const result = compiled.value;
  if (result.ok && result.stored !== effectiveStored.value) change([id.value], (data) => setStream(data, id.value, { text: result.stored }));
}

async function insertKey(key: string) {
  const field = textField.value?.$el;
  const token = `{${key}}`;
  const start = field?.selectionStart ?? groupText.value.length;
  const end = field?.selectionEnd ?? start;
  groupText.value = groupText.value.slice(0, start) + token + groupText.value.slice(end);
  await nextTick();
  field?.focus();
  field?.setSelectionRange(start + token.length, start + token.length);
}

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
const preview = computed(() => formatSeconds(4 * 3600 + 5 * 60 + 9, formatValid.value ? format.value : "m:ss"));

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

function resetLink() {
  return attempt(linkNote, async () => {
    await panel.resetLink(props.item);
    linkNote.value = t("edit.resetLinkDone");
  });
}

const font = computed({ get: () => look.value.font, set: (next: Font) => updateLook((look) => (look.font = next)) });
const align = computed({ get: () => look.value.align, set: (next: Align) => updateLook((look) => (look.align = next)) });

// ── Hotkeys ──────────────────────────────────────────────────────────

const actions = computed(() => ACTIONS[props.item.kind].filter((action) => action !== "lap" || (props.item.kind === "stopwatch" && props.item.laps)));
const hasKey = (action: string) => panel.hotkeys.value.has(`${action}:${id.value}`);
const hotkeyNote = ref<string | null>(null);

function setKey(action: string) {
  hotkeyNote.value = null;
  return attempt(hotkeyNote, () => panel.setHotkey(action, props.item));
}

// ── Closing ──────────────────────────────────────────────────────────

/** Saves what is still typed in the open page's fields, even if the browser never sends their blur (the page changes, the dialog goes). */
function saveFields() {
  saveLabel();
  if (props.item.kind !== "counter" && isFormat(format.value)) saveFormat();
  if (props.item.kind === "countdown") {
    saveDuration();
    saveDoneText();
  }
  if (props.item.kind === "counter") {
    if (group.value?.stream.whole) saveGroupText();
    saveStep();
    saveGoal();
    Object.keys(amountDrafts).forEach(saveLinkAmount);
  }
}

onBeforeUnmount(() => {
  observer?.disconnect();
  saveFields();
});
</script>

<template>
  <div ref="root" class="flex h-full min-h-0 flex-col text-sm" :data-testid="`editor-${item.id}`">
    <!-- Tavora's frame names the item when it can (`titled`); an older Tavora can't, and then the page does. -->
    <header v-if="page && titled === false" class="flex h-12 flex-none items-center border-b px-4">
      <h2 class="min-w-0 truncate text-base font-semibold">{{ name }}</h2>
    </header>

    <div class="flex min-h-0 flex-1" :class="folded && 'flex-col'">
      <NavList v-if="!folded" v-model="current" :groups="navGroups" :label="t('edit.pages')" class="bg-background w-[200px] flex-none overflow-y-auto border-r p-3" />
      <div v-else class="flex-none border-b px-4 py-3">
        <Picker v-model="current" :options="pageOptions" :label="t('edit.pages')" class="w-full" testid="page-picker" />
      </div>

      <div ref="holder" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- The page is named by the list (or the dropdown) and the dialog by its frame, so no heading of its own. -->
        <section :aria-label="pageTitle" class="min-h-0 flex-1 overflow-y-auto px-8 pb-6 [scrollbar-width:thin]" data-testid="settings-page">
          <!-- How it counts -->
          <template v-if="current === 'item'">
            <SettingsSection>
              <SettingsRow :label="t('edit.name')" :stacked="stacked">
                <Input :id="`${prefix}-label`" v-model="label" class="w-full" :maxlength="MAX.label" :placeholder="t(`kind.${item.kind}`)" :aria-label="t('edit.name')" @blur="saveLabel" @keydown.enter="saveLabel" />
              </SettingsRow>

              <template v-if="item.kind !== 'counter'">
                <SettingsRow :label="t('edit.format')" :hint="formatValid ? t('edit.formatHint', { text: preview }) : undefined" :stacked="stacked">
                  <div class="flex w-full gap-1">
                    <Input :id="`${prefix}-format`" v-model="format" class="min-w-0 flex-1 font-mono" :maxlength="MAX_FORMAT" :aria-label="t('edit.format')" :aria-invalid="!formatValid" :title="t('edit.formatHelp')" @blur="saveFormat()" @keydown.enter="saveFormat()" />
                    <!-- Kit menus, not ui.showMenu: Tavora draws no module menu while the panel is a dialog over the workspace. -->
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button variant="secondary" size="sm" class="h-8" :aria-label="t('edit.formatPresets')" :title="t('edit.formatPresets')" data-testid="format-presets">···</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup :model-value="format" @update:model-value="(preset) => saveFormat(String(preset))">
                          <DropdownMenuRadioItem v-for="preset in FORMAT_PRESETS" :key="preset" :value="preset" class="tabular-nums">{{ preset }} · {{ formatSeconds(4 * 3600 + 5 * 60 + 9, preset) }}</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p v-if="!formatValid" class="text-destructive w-full text-xs" role="alert">{{ t("edit.formatInvalid") }}</p>
                </SettingsRow>

                <template v-if="item.kind === 'countdown'">
                  <SettingsRow :label="t('edit.duration')" :stacked="stacked">
                    <div class="flex items-center gap-1">
                      <Input :id="`${prefix}-h`" v-model="duration.h" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="2" :aria-label="t('edit.hours')" @blur="saveDuration" @keydown.enter="saveDuration" />
                      <span aria-hidden="true">:</span>
                      <Input :id="`${prefix}-m`" v-model="duration.m" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="3" :aria-label="t('edit.minutes')" @blur="saveDuration" @keydown.enter="saveDuration" />
                      <span aria-hidden="true">:</span>
                      <Input :id="`${prefix}-s`" v-model="duration.s" class="w-14 text-center tabular-nums" inputmode="numeric" maxlength="4" :aria-label="t('edit.seconds')" @blur="saveDuration" @keydown.enter="saveDuration" />
                    </div>
                  </SettingsRow>
                  <SettingsRow :label="t('edit.repeat')" :stacked="stacked">
                    <Switch :model-value="item.repeat" :aria-label="t('edit.repeat')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.repeat = on))" />
                  </SettingsRow>
                  <SettingsRow v-if="!item.repeat" :label="t('edit.doneText')" :hint="t('edit.doneTextHint')" :stacked="stacked">
                    <Input :id="`${prefix}-done`" v-model="doneText" class="w-full" :maxlength="MAX.doneText" :placeholder="t('item.done')" :aria-label="t('edit.doneText')" @blur="saveDoneText" @keydown.enter="saveDoneText" />
                  </SettingsRow>
                </template>

                <template v-else>
                  <SettingsRow :label="t('edit.laps')" :stacked="stacked">
                    <Switch :model-value="item.laps" :aria-label="t('edit.laps')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.laps = on))" />
                  </SettingsRow>
                  <SettingsRow v-if="item.laps" :label="t('edit.lastLap')" :stacked="stacked">
                    <Switch :model-value="item.showLastLap" :aria-label="t('edit.lastLap')" @update:model-value="(on: boolean) => updateClock((clock) => (clock.showLastLap = on))" />
                  </SettingsRow>
                </template>
              </template>

              <template v-else>
                <SettingsRow :label="t('edit.step')" :stacked="stacked">
                  <Input :id="`${prefix}-step`" v-model="step" class="w-24 tabular-nums" inputmode="numeric" :aria-label="t('edit.step')" @blur="saveStep" @keydown.enter="saveStep" />
                </SettingsRow>
                <SettingsRow :label="t('edit.goal')" :hint="t('edit.goalHint')" :stacked="stacked">
                  <Input :id="`${prefix}-goal`" v-model="goal" class="w-24 tabular-nums" inputmode="numeric" :aria-label="t('edit.goal')" @blur="saveGoal" @keydown.enter="saveGoal" />
                </SettingsRow>
                <SettingsRow :label="t('edit.negative')" :stacked="stacked">
                  <Switch :model-value="item.negative" :aria-label="t('edit.negative')" @update:model-value="(on: boolean) => updateCounter((counter) => (counter.negative = on))" />
                </SettingsRow>
                <SettingsRow :label="t('edit.links')" :hint="t('edit.linksHint')" :stacked="stacked">
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
                <SettingsRow v-for="link in links" :key="link.target" :label="link.label" :stacked="stacked">
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
          </template>

          <!-- How it looks on stream -->
          <SettingsSection v-else-if="current === 'look'">
            <SettingsRow :label="t('edit.color')" :stacked="stacked">
              <ColorPicker :model-value="look.color" :label="t('edit.color')" :colors="[...COLORS]" :labels="COLOR_NAMES.map((name) => t(`color.${name}`))" :columns="5" @update:model-value="(color: string) => updateLook((look) => (look.color = color))" />
            </SettingsRow>
            <SettingsRow :label="t('edit.font')" :stacked="stacked">
              <SegmentedControl v-model="font" :label="t('edit.font')" :options="FONTS.map((value) => ({ value, label: t(`edit.font.${value}`) }))" class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0" />
            </SettingsRow>
            <SettingsRow :label="t('edit.align')" :stacked="stacked">
              <SegmentedControl v-model="align" :label="t('edit.align')" :options="ALIGNS.map((value) => ({ value, label: t(`edit.align.${value}`) }))" class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0" />
            </SettingsRow>
            <SettingsRow :label="t('edit.outline')" :stacked="stacked">
              <Switch :model-value="look.outline" :aria-label="t('edit.outline')" @update:model-value="(on: boolean) => updateLook((look) => (look.outline = on))" />
            </SettingsRow>
            <SettingsRow v-if="!whole" :label="t('edit.showLabel')" :stacked="stacked">
              <Switch :model-value="look.showLabel" :aria-label="t('edit.showLabel')" @update:model-value="(on: boolean) => updateLook((look) => (look.showLabel = on))" />
            </SettingsRow>
          </SettingsSection>

          <!-- Hotkeys -->
          <SettingsSection v-else-if="current === 'hotkeys'">
            <SettingsRow v-for="action in actions" :key="action" :label="t(`action.${action}`)" :stacked="stacked">
              <span class="text-muted-foreground text-xs" :data-testid="`hotkey-${action}-${item.id}`">{{ hasKey(action) ? t("edit.hotkeyOn") : t("edit.hotkeyNone") }}</span>
              <Button variant="secondary" size="sm" :aria-label="`${t(`action.${action}`)}: ${hasKey(action) ? t('edit.hotkeyChange') : t('edit.hotkeySet')}`" @click="setKey(action)">{{ hasKey(action) ? t("edit.hotkeyChange") : t("edit.hotkeySet") }}</Button>
            </SettingsRow>
            <p class="text-muted-foreground pt-3 text-xs">{{ t("edit.hotkeysHint") }}</p>
            <p v-if="hotkeyNote" class="text-muted-foreground pt-2 text-xs" role="status" data-testid="hotkey-note">{{ hotkeyNote }}</p>
          </SettingsSection>

          <!-- On stream -->
          <SettingsSection v-else>
            <template v-if="group">
              <SettingsRow :label="t('edit.scope')" :hint="t('edit.scopeHint')" :stacked="stacked">
                <SegmentedControl
                  v-model="scope"
                  :label="t('edit.scope')"
                  :options="[
                    { value: 'self', label: t('edit.scopeSelf'), testid: 'scope-self' },
                    { value: 'group', label: t('edit.scopeGroup'), testid: 'scope-group' },
                  ]"
                  class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0"
                />
              </SettingsRow>
              <SettingsRow v-if="whole" :label="t('edit.groupText')" stacked>
                <div class="flex w-full flex-col gap-1.5">
                  <div class="flex items-center gap-2">
                    <Input
                      :id="`${prefix}-gtext`"
                      ref="textField"
                      v-model="groupText"
                      :maxlength="MAX.text"
                      :aria-label="t('edit.groupText')"
                      :aria-invalid="!!problem"
                      :aria-describedby="problem ? `${prefix}-gproblem` : undefined"
                      data-testid="group-text"
                      @blur="saveGroupText"
                      @keydown.enter="saveGroupText"
                    />
                    <span v-if="problem" class="text-destructive flex-none" role="img" :aria-label="problem" :title="problem" data-testid="group-problem-x"><X class="size-4" :stroke-width="2" aria-hidden="true" /></span>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <Button v-for="chip in chips" :key="chip.id" variant="secondary" size="xs" :aria-label="t('edit.groupInsert', { name: chip.name })" :title="t('edit.groupInsert', { name: chip.name })" :data-testid="`group-chip-${chip.key}`" @mousedown.prevent @click="insertKey(chip.key)">
                      {{ chip.key }}
                    </Button>
                  </div>
                  <p v-if="problem" :id="`${prefix}-gproblem`" class="text-destructive text-xs" role="alert" data-testid="group-problem">{{ problem }} {{ t("edit.groupInvalid") }}</p>
                  <p v-else class="text-muted-foreground text-xs" data-testid="group-preview">{{ t("edit.preview", { text: groupPreview }) }}</p>
                  <p class="text-muted-foreground text-xs">{{ t("edit.groupHint") }}</p>
                </div>
              </SettingsRow>
            </template>
            <SettingsRow :label="t('edit.obsLink')" :hint="t('edit.obsLinkHint')" :stacked="stacked">
              <Button variant="secondary" size="sm" :data-testid="`copy-link-${item.id}`" @click="copyLink">{{ t("edit.copyLink") }}</Button>
              <Button variant="secondary" size="sm" :data-testid="`preview-${item.id}`" @click="previewOverlay">{{ t("edit.previewOverlay") }}</Button>
            </SettingsRow>
            <SettingsRow v-if="panel.store.overlays.value" :label="t('edit.resetLink')" :hint="t('edit.resetLinkHint')" :stacked="stacked">
              <Button variant="secondary" size="sm" data-testid="reset-link" @click="resetLink">{{ t("edit.resetLink") }}</Button>
            </SettingsRow>
            <p v-if="linkNote" class="text-muted-foreground pt-3 text-xs" role="status" data-testid="link-note">{{ linkNote }}</p>
          </SettingsSection>
        </section>
      </div>
    </div>

    <footer class="flex h-14 flex-none items-center gap-2 border-t px-4">
      <DialogButton variant="danger" :icon="Trash2" :data-testid="`delete-${item.id}`" @click="panel.remove(item)">{{ t("edit.delete") }}</DialogButton>
      <DialogButton close class="ml-auto" variant="default" data-testid="editor-done" @click="emit('close')">{{ t("edit.done") }}</DialogButton>
    </footer>
  </div>
</template>
