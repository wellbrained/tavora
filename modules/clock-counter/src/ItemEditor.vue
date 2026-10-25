<script setup lang="ts">
// An item's settings, below its card: name and how it counts, how it looks on stream with its OBS link, and its
// hotkeys. Text and number fields save when they lose focus or on Enter, not on every key.
import { ArrowDown, ArrowUp, Check, Link, Plus, Trash2, X } from "@lucide/vue";
import { cn, SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed, inject, ref, watch } from "vue";
import { t } from "./i18n";
import { ALIGNS, COLORS, find, FONTS, MAX, move, type Align, type Clock, type Counter, type Font, type Item, type ItemList, type OverlayLook } from "./items";
import { ACTIONS, PANEL } from "./panel";
import { FORMAT_PRESETS, formatSeconds, isFormat, MAX_FORMAT } from "./time";

const props = defineProps<{ item: Item; first: boolean; last: boolean }>();
const panel = inject(PANEL)!;
const id = computed(() => props.item.id);
const prefix = computed(() => `cc-${props.item.id}`);

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
const updateLook = (apply: (look: OverlayLook) => void) => update((item) => apply(item.look));

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

async function pickFormat(event: MouseEvent) {
  const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const picked = await panel.showMenu({
    items: FORMAT_PRESETS.map((preset) => ({ type: "item" as const, id: preset, label: `${preset}  ·  ${formatSeconds(4 * 3600 + 5 * 60 + 9, preset)}`, checked: format.value === preset })),
    at: { x: button.left, y: button.top, width: button.width, height: button.height },
    align: "end",
  });
  if (picked) saveFormat(picked);
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

async function addLink(event: MouseEvent) {
  const button = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const picked = await panel.showMenu({
    items: [{ type: "heading", label: t("edit.linkPick") }, ...unlinked.value.map((counter) => ({ type: "item" as const, id: counter.id, label: counter.label || t("kind.counter") }))],
    at: { x: button.left, y: button.top, width: button.width, height: button.height },
  });
  if (picked) updateCounter((counter) => counter.links.length < MAX.links && !counter.links.some((link) => link.target === picked) && counter.links.push({ target: picked, amount: 1 }));
}

function saveLinkAmount(target: string, value: string) {
  const amount = Math.min(MAX.value, Math.max(-MAX.value, number(value, 1))) || 1;
  updateCounter((counter) => {
    const link = counter.links.find((item) => item.target === target);
    if (link) link.amount = amount;
  });
}

const removeLink = (target: string) => updateCounter((counter) => (counter.links = counter.links.filter((link) => link.target !== target)));

// ── On stream ────────────────────────────────────────────────────────

const linkNote = ref<string | null>(null);

async function copyLink() {
  const result = await panel.copyLink(props.item);
  linkNote.value = t(result === "copied" ? "edit.copied" : result === "off" ? "edit.overlaysOff" : "edit.noOverlay");
}

async function showOverGame() {
  const result = await panel.showOverGame(props.item);
  linkNote.value = result === "shown" ? t("edit.shownOverGame") : result === "full" ? t("edit.overGameFull") : null;
}

async function resetLink() {
  await panel.resetLink(props.item);
  linkNote.value = t("edit.resetLinkDone");
}

const font = computed({ get: () => props.item.look.font, set: (next: Font) => updateLook((look) => (look.font = next)) });
const align = computed({ get: () => props.item.look.align, set: (next: Align) => updateLook((look) => (look.align = next)) });

// ── Hotkeys ──────────────────────────────────────────────────────────

const actions = computed(() => ACTIONS[props.item.kind].filter((action) => action !== "lap" || (props.item.kind === "stopwatch" && props.item.laps)));
const hasKey = (action: string) => panel.hotkeys.value.has(`${action}:${id.value}`);
</script>

<template>
  <div class="flex flex-col gap-4 border-t px-3 py-3 text-sm" :data-testid="`editor-${item.id}`">
    <div class="flex flex-col gap-1.5">
      <Label :for="`${prefix}-label`">{{ t("edit.name") }}</Label>
      <Input :id="`${prefix}-label`" v-model="label" :maxlength="MAX.label" :placeholder="t(`kind.${item.kind}`)" @blur="saveLabel" @keydown.enter="saveLabel" />
    </div>

    <template v-if="item.kind !== 'counter'">
      <div class="flex flex-col gap-1.5">
        <Label :for="`${prefix}-format`">{{ t("edit.format") }}</Label>
        <div class="flex gap-1">
          <Input :id="`${prefix}-format`" v-model="format" class="font-mono" :maxlength="MAX_FORMAT" :aria-invalid="!formatValid" @blur="saveFormat()" @keydown.enter="saveFormat()" />
          <Button variant="secondary" size="sm" class="h-8" :aria-label="t('edit.formatPresets')" :title="t('edit.formatPresets')" @click="pickFormat">···</Button>
        </div>
        <p v-if="!formatValid" class="text-destructive text-xs" role="alert">{{ t("edit.formatInvalid") }}</p>
        <p class="text-muted-foreground text-xs">{{ t("edit.preview", { text: preview }) }} · {{ t("edit.formatHint") }}</p>
      </div>

      <template v-if="item.kind === 'countdown'">
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1.5 font-medium">{{ t("edit.duration") }}</legend>
          <div class="flex items-center gap-1">
            <Input :id="`${prefix}-h`" v-model="duration.h" class="w-16 tabular-nums" inputmode="numeric" maxlength="2" :aria-label="t('edit.hours')" @blur="saveDuration" @keydown.enter="saveDuration" />
            <span aria-hidden="true">:</span>
            <Input :id="`${prefix}-m`" v-model="duration.m" class="w-16 tabular-nums" inputmode="numeric" maxlength="3" :aria-label="t('edit.minutes')" @blur="saveDuration" @keydown.enter="saveDuration" />
            <span aria-hidden="true">:</span>
            <Input :id="`${prefix}-s`" v-model="duration.s" class="w-16 tabular-nums" inputmode="numeric" maxlength="4" :aria-label="t('edit.seconds')" @blur="saveDuration" @keydown.enter="saveDuration" />
          </div>
        </fieldset>
        <Label class="justify-between font-normal">
          {{ t("edit.repeat") }}
          <Switch :model-value="item.repeat" @update:model-value="(on: boolean) => updateClock((clock) => (clock.repeat = on))" />
        </Label>
        <div v-if="!item.repeat" class="flex flex-col gap-1.5">
          <Label :for="`${prefix}-done`">{{ t("edit.doneText") }}</Label>
          <Input :id="`${prefix}-done`" v-model="doneText" :maxlength="MAX.doneText" :placeholder="t('item.done')" @blur="saveDoneText" @keydown.enter="saveDoneText" />
          <p class="text-muted-foreground text-xs">{{ t("edit.doneTextHint") }}</p>
        </div>
      </template>

      <template v-else>
        <Label class="justify-between font-normal">
          {{ t("edit.laps") }}
          <Switch :model-value="item.laps" @update:model-value="(on: boolean) => updateClock((clock) => (clock.laps = on))" />
        </Label>
        <Label v-if="item.laps" class="justify-between font-normal">
          {{ t("edit.lastLap") }}
          <Switch :model-value="item.showLastLap" @update:model-value="(on: boolean) => updateClock((clock) => (clock.showLastLap = on))" />
        </Label>
      </template>
    </template>

    <template v-else>
      <div class="flex flex-wrap gap-3">
        <div class="flex flex-col gap-1.5">
          <Label :for="`${prefix}-step`">{{ t("edit.step") }}</Label>
          <Input :id="`${prefix}-step`" v-model="step" class="w-24 tabular-nums" inputmode="numeric" @blur="saveStep" @keydown.enter="saveStep" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label :for="`${prefix}-goal`">{{ t("edit.goal") }}</Label>
          <Input :id="`${prefix}-goal`" v-model="goal" class="w-24 tabular-nums" inputmode="numeric" @blur="saveGoal" @keydown.enter="saveGoal" />
        </div>
      </div>
      <p class="text-muted-foreground -mt-2 text-xs">{{ t("edit.goalHint") }}</p>
      <Label class="justify-between font-normal">
        {{ t("edit.negative") }}
        <Switch :model-value="item.negative" @update:model-value="(on: boolean) => updateCounter((counter) => (counter.negative = on))" />
      </Label>

      <section class="flex flex-col gap-1.5" :aria-label="t('edit.links')">
        <h3 class="font-medium">{{ t("edit.links") }}</h3>
        <p class="text-muted-foreground text-xs">{{ t("edit.linksHint") }}</p>
        <ul v-if="links.length" class="flex flex-col gap-1">
          <li v-for="link in links" :key="link.target" class="flex items-center gap-2">
            <Input
              :model-value="String(link.amount)"
              class="w-20 tabular-nums"
              inputmode="numeric"
              :aria-label="t('edit.linkAmount', { label: link.label })"
              @blur="(event: FocusEvent) => saveLinkAmount(link.target, (event.target as HTMLInputElement).value)"
              @keydown.enter="(event: KeyboardEvent) => saveLinkAmount(link.target, (event.target as HTMLInputElement).value)"
            />
            <Link class="text-muted-foreground size-3.5 flex-none" :stroke-width="1.5" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ link.label }}</span>
            <Button variant="ghost" size="icon-sm" :aria-label="t('edit.linkRemove', { label: link.label })" :title="t('edit.linkRemove', { label: link.label })" @click="removeLink(link.target)">
              <X :stroke-width="1.5" />
            </Button>
          </li>
        </ul>
        <Button v-if="unlinked.length && item.links.length < MAX.links" variant="secondary" size="sm" class="self-start" @click="addLink"><Plus :stroke-width="1.5" /> {{ t("edit.linkAdd") }}</Button>
      </section>
    </template>

    <section class="flex flex-col gap-2" :aria-label="t('edit.stream')">
      <h3 class="font-medium">{{ t("edit.stream") }}</h3>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" :data-testid="`copy-link-${item.id}`" @click="copyLink">{{ t("edit.copyLink") }}</Button>
        <Button size="sm" variant="secondary" :data-testid="`show-over-game-${item.id}`" @click="showOverGame">{{ t("edit.showOverGame") }}</Button>
        <Button v-if="panel.store.overlays.value" variant="ghost" size="sm" @click="resetLink">{{ t("edit.resetLink") }}</Button>
      </div>
      <p v-if="linkNote" class="text-muted-foreground text-xs" role="status">{{ linkNote }}</p>
      <Label class="justify-between font-normal">
        {{ t("edit.showLabel") }}
        <Switch :model-value="item.look.showLabel" @update:model-value="(on: boolean) => updateLook((look) => (look.showLabel = on))" />
      </Label>
      <Label class="justify-between font-normal">
        {{ t("edit.outline") }}
        <Switch :model-value="item.look.outline" @update:model-value="(on: boolean) => updateLook((look) => (look.outline = on))" />
      </Label>
      <div class="flex flex-col gap-1.5">
        <span class="font-medium">{{ t("edit.color") }}</span>
        <div class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('edit.color')">
          <button
            v-for="(color, index) in COLORS"
            :key="color"
            type="button"
            role="radio"
            :aria-checked="item.look.color === color"
            :aria-label="t(`color.${COLOR_NAMES[index]!}`)"
            :title="t(`color.${COLOR_NAMES[index]!}`)"
            :class="cn('grid size-6 place-items-center rounded-full border', item.look.color === color && 'ring-ring ring-2 ring-offset-1 ring-offset-[var(--card)]')"
            :style="{ background: color }"
            @click="updateLook((look) => (look.color = color))"
          >
            <Check v-if="item.look.color === color" class="size-3.5" :stroke-width="2.5" :style="{ color: index === COLORS.length - 1 ? '#fff' : '#111' }" />
          </button>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-medium">{{ t("edit.font") }}</span>
        <SegmentedControl v-model="font" :label="t('edit.font')" :options="FONTS.map((value) => ({ value, label: t(`edit.font.${value}`) }))" />
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-medium">{{ t("edit.align") }}</span>
        <SegmentedControl v-model="align" :label="t('edit.align')" :options="ALIGNS.map((value) => ({ value, label: t(`edit.align.${value}`) }))" />
      </div>
    </section>

    <section class="flex flex-col gap-1.5" :aria-label="t('edit.hotkeys')">
      <h3 class="font-medium">{{ t("edit.hotkeys") }}</h3>
      <p class="text-muted-foreground text-xs">{{ t("edit.hotkeysHint") }}</p>
      <ul class="flex flex-col">
        <li v-for="action in actions" :key="action" class="flex min-h-8 items-center gap-2">
          <span class="min-w-0 flex-1 truncate">{{ t(`action.${action}`) }}</span>
          <span class="text-muted-foreground text-xs" :data-testid="`hotkey-${action}-${item.id}`">{{ hasKey(action) ? t("edit.hotkeyOn") : t("edit.hotkeyNone") }}</span>
          <Button variant="secondary" size="sm" :aria-label="`${t(`action.${action}`)}: ${hasKey(action) ? t('edit.hotkeyChange') : t('edit.hotkeySet')}`" @click="panel.setHotkey(action, item)">{{ hasKey(action) ? t("edit.hotkeyChange") : t("edit.hotkeySet") }}</Button>
        </li>
      </ul>
    </section>

    <div class="flex flex-wrap items-center gap-1 border-t pt-3">
      <Button variant="ghost" size="sm" :disabled="first" @click="change([], (data) => move(data, item.id, -1))"><ArrowUp :stroke-width="1.5" /> {{ t("edit.moveUp") }}</Button>
      <Button variant="ghost" size="sm" :disabled="last" @click="change([], (data) => move(data, item.id, 1))"><ArrowDown :stroke-width="1.5" /> {{ t("edit.moveDown") }}</Button>
      <Button variant="danger" size="sm" class="ml-auto" :data-testid="`delete-${item.id}`" @click="panel.remove(item)"><Trash2 :stroke-width="1.5" /> {{ t("edit.delete") }}</Button>
    </div>
  </div>
</template>
