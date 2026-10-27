<script setup lang="ts">
// Calculator: the sum and its result as you type, a keypad (the keyboard works too, with the Windows shortcuts @ for √,
// q for x² and F9 for ±), Copy, and the game's last results. The toolbar switches between the Basic keypad and Plus,
// which is laid out like the Windows one, and shows or hides the history; its ⚙ menu picks the history length, the
// decimal places and the short form (1.5M) results show with. All of these hold in every game.
// The keypad keeps a calculator size: its keys never shrink below a button nor grow past a big one. The history sits
// beside it once the panel is wide enough for both, else below; a panel too short for both scrolls.
// Save as… keeps the result under a name; the Values tab taps it into a sum, where it counts with its number now.
// The history and the values live in the game's module storage, so every panel of the game shares them; a panel
// reads them again when it shows or gets focus, since storage has no change events.
import { BookmarkPlus, Check, Copy, Delete, Ellipsis, History, Pencil, Settings2, Trash2 } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage, SegmentedControl, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import type { JsonValue, TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from "vue";
import { copyText, EMPTY, evaluate, format, insert, press, pretty, reference, rounded, segments, type Entry } from "./calc";
import { HISTORY_KEY, parseHistory, remember, type Calculation } from "./history";
import { language, setLanguage, t } from "./i18n";
import type { en } from "./locales";
import { DECIMALS, DEFAULT_SETTINGS, HISTORY_LENGTHS, parseSettings, SETTINGS_KEY, type Decimals, type Mode, type Settings } from "./settings";
import ValueDialog from "./ValueDialog.vue";
import { deleteValue, lookup, parseValues, renameValue, saveValue, VALUES_KEY, type Value } from "./values";

type Key = { key: string; label: string; name?: keyof typeof en; kind: "digit" | "op" | "clear" | "equals" };

const digits = (keys: string[]) => keys.map((key) => ({ key, label: key, kind: "digit" as const }));

/** The classic pocket calculator. */
const BASIC: Key[] = [
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  ...digits(["7", "8", "9"]),
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...digits(["4", "5", "6"]),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...digits(["1", "2", "3"]),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "0", label: "0", kind: "digit" },
  { key: ".", label: ".", name: "calc.point", kind: "digit" },
  { key: "=", label: "=", name: "calc.equals", kind: "equals" },
];

/** Laid out like the Windows calculator, with √, x², ± and ans, and a row for big numbers and rounding up. */
const PLUS: Key[] = [
  { key: "k", label: "k", name: "calc.thousand", kind: "op" },
  { key: "m", label: "m", name: "calc.million", kind: "op" },
  { key: "b", label: "b", name: "calc.billion", kind: "op" },
  { key: "ceil", label: "⌈x⌉", name: "calc.ceil", kind: "op" },
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  { key: "sqrt", label: "√", name: "calc.sqrt", kind: "op" },
  { key: "square", label: "x²", name: "calc.square", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...digits(["7", "8", "9"]),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...digits(["4", "5", "6"]),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  ...digits(["1", "2", "3"]),
  { key: "negate", label: "±", name: "calc.negate", kind: "op" },
  { key: "ans", label: "ans", name: "calc.ans", kind: "op" },
  { key: "0", label: "0", kind: "digit" },
  { key: ".", label: ".", name: "calc.point", kind: "digit" },
  { key: "=", label: "=", name: "calc.equals", kind: "equals" },
];

const VARIANT = { digit: "secondary", op: "outline", clear: "outline", equals: "default" } as const;
/** The keypad's rows by number of keys; written out so Tailwind finds the classes. */
const ROWS: Record<number, string> = {
  20: "grid-rows-[repeat(5,minmax(2rem,1fr))]",
  28: "grid-rows-[repeat(7,minmax(2rem,1fr))]",
};

const sdk = shallowRef<TavoraSDK | null>(null);
const error = ref<string | null>(null);
const saveError = ref<string | null>(null);
/** Clear history asked, waiting for the player to confirm. */
const clearing = ref(false);
const entry = ref<Entry>(EMPTY);
/** Why the last Equals did not work, until the next key. */
const problem = ref<string | null>(null);
const history = ref<Calculation[]>([]);
const values = ref<Value[]>([]);
const lookupValue = computed(() => lookup(values.value));
const tab = ref<"history" | "values">("history");
/** The lists' open tab: only Values while the history is hidden. */
const shownTab = computed({
  get: () => (settings.value.history ? tab.value : "values"),
  set: (value: string | number) => void (tab.value = value === "values" ? "values" : "history"),
});
/** The value dialog that is open: Save as…, or Rename for a value's name. */
const valueDialog = ref<{ renaming?: string } | null>(null);
/** Delete asked for this value, waiting for the player to confirm. */
const deleting = ref<string | null>(null);
/** Copy just worked: its button shows a tick for a moment. */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const settings = ref<Settings>(DEFAULT_SETTINGS);
const queue = serial();

const modes = computed(() => [
  { value: "basic" as Mode, label: t("mode.basic"), testid: "mode-basic" },
  { value: "plus" as Mode, label: t("mode.plus"), testid: "mode-plus" },
]);
const mode = computed({ get: () => settings.value.mode, set: (value: Mode) => choose({ mode: value }) });

const keys = computed(() => (settings.value.mode === "basic" ? BASIC : PLUS));

// The ⚙ menu's radio groups hand over strings.
const historyLength = computed({
  get: () => String(settings.value.historyLength),
  set: (value: string) => {
    const length = HISTORY_LENGTHS.find((option) => String(option) === value);
    if (!length) return;
    choose({ historyLength: length });
    if (history.value.length > length) save((items) => items.slice(0, length));
  },
});
const decimals = computed({
  get: () => String(settings.value.decimals),
  set: (value: string) => {
    const picked = DECIMALS.find((option) => String(option) === value);
    if (picked !== undefined) choose({ decimals: picked });
  },
});
const decimalsLabel = (option: Decimals) => (option === "auto" ? t("options.decimalsAuto") : String(option));
/** The history as long as the player picked. */
const recent = computed(() => history.value.slice(0, settings.value.historyLength));

/** Changes a toolbar choice and keeps it for every game. */
function choose(change: Partial<Settings>): void {
  settings.value = { ...settings.value, ...change };
  void sdk.value?.storage.app
    .set(SETTINGS_KEY, { ...settings.value })
    .then(() => void (saveError.value = null))
    .catch((reason: unknown) => {
      saveError.value = t("settingsError", { error: errorMessage(reason) });
    });
}

const comma = computed(() => language.value.toLowerCase().startsWith("de"));
const show = (text: string) => pretty(text, comma.value);
/** A result as it shows, with the decimal places and short form picked; the number itself keeps every digit. */
const showResult = (text: string) => show(rounded(text, settings.value.decimals, settings.value.short));
const keyLabel = (key: Key) => (key.key === "." && comma.value ? "," : key.label);

const outcome = computed(() => evaluate(entry.value.text, lookupValue.value));
/** A value in the sum was deleted. */
const missing = computed(() => !outcome.value.ok && outcome.value.reason === "missing");

/** The result so far, shown under the sum while typing. */
const preview = computed(() => {
  if (entry.value.fresh || !outcome.value.ok) return "";
  const result = format(outcome.value.value);
  return result === entry.value.text ? "" : result;
});

function key(name: string): void {
  problem.value = null;
  if (name === "=") return equals();
  if (name === "ans") return void (history.value[0] && use(history.value[0]));
  entry.value = press(entry.value, name);
}

/** The result as Copy writes it, or null while there is none. */
const copyable = computed(() => copyText(entry.value, comma.value, lookupValue.value));
/** The result as Save as… keeps it, or null while there is none. */
const savable = computed(() => (outcome.value.ok ? format(outcome.value.value) : null));

async function copy(): Promise<void> {
  const text = copyable.value;
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    problem.value = t("copyError");
  }
}

function equals(): void {
  const text = entry.value.text;
  if (!text || entry.value.fresh) return;
  const worked = outcome.value;
  if (!worked.ok) {
    problem.value = t(`error.${worked.reason}`);
    return;
  }
  const result = format(worked.value);
  entry.value = { text: result, fresh: true };
  if (result !== text) save((items) => remember(items, { expression: text, result }, settings.value.historyLength));
}

function use(calculation: Calculation): void {
  problem.value = null;
  entry.value = insert(entry.value, calculation.result);
}

// ── History and values ───────────────────────────────────────────────

/** Reads the newest list from the game's storage, changes it and writes it back, one save at a time. */
function update<T extends Calculation | Value>(
  key: string,
  list: Ref<T[]>,
  parse: (raw: JsonValue | null) => T[],
  failure: "saveError" | "valuesError",
  change: (items: T[]) => T[],
): void {
  list.value = change(list.value);
  void queue(async () => {
    const connected = sdk.value;
    if (!connected) return;
    try {
      const next = change(parse(await connected.storage.get(key)));
      await connected.storage.set(key, next.map((item) => ({ ...item })));
      list.value = next;
      saveError.value = null;
    } catch (reason) {
      saveError.value = t(failure, { error: errorMessage(reason) });
    }
  });
}

const save = (change: (items: Calculation[]) => Calculation[]) => update(HISTORY_KEY, history, parseHistory, "saveError", change);
const saveValues = (change: (items: Value[]) => Value[]) => update(VALUES_KEY, values, parseValues, "valuesError", change);

/** Saves the current result under a name, or renames a value, from the value dialog. */
function submitValue(name: string): void {
  const renaming = valueDialog.value?.renaming;
  valueDialog.value = null;
  if (renaming !== undefined) return saveValues((items) => renameValue(items, renaming, name) ?? items);
  const number = savable.value;
  if (number === null) return;
  saveValues((items) => saveValue(items, { name, value: number }) ?? items);
  tab.value = "values";
}

function confirmDelete(): void {
  const name = deleting.value;
  deleting.value = null;
  if (name !== null) saveValues((items) => deleteValue(items, name));
}

/** Opens a dialog from the item menu once the menu has closed, so the dialog keeps the focus. */
const later = (open: () => void) => setTimeout(open, 120);

function tap(value: Value): void {
  problem.value = null;
  entry.value = reference(entry.value, value.name);
}

function confirmClear(): void {
  clearing.value = false;
  save(() => []);
}

function reload(): void {
  void queue(async () => {
    const stored = await sdk.value?.storage.get(HISTORY_KEY).catch(() => undefined);
    if (stored !== undefined) history.value = parseHistory(stored);
    const storedValues = await sdk.value?.storage.get(VALUES_KEY).catch(() => undefined);
    if (storedValues !== undefined) values.value = parseValues(storedValues);
  });
}

// ── Keyboard and paste ───────────────────────────────────────────────

const KEYBOARD: Record<string, string> = {
  Enter: "=",
  "=": "=",
  Backspace: "back",
  Escape: "clear",
  Delete: "clear",
  ",": ".",
  x: "*",
  X: "*",
  ":": "/",
  // The Windows calculator's own shortcuts.
  "@": "sqrt",
  q: "square",
  Q: "square",
  F9: "negate",
  k: "k",
  K: "k",
  m: "m",
  M: "m",
  b: "b",
  B: "b",
};

/** Whether a key or paste is meant for a text field or a dialog rather than the calculator. */
const elsewhere = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input, textarea, [role='dialog']");

function onKeydown(event: KeyboardEvent): void {
  if (elsewhere(event.target)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
    event.preventDefault();
    return void copy();
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // A focused button or option keeps its own Enter, so the keyboard can still press it; a dialog keeps its keys.
  const focused = event.target instanceof HTMLElement && event.target.closest("button, [role='radio'], [role='tab']");
  if (focused && (event.key === "Enter" || event.key === "Escape" || event.key === "Backspace" || event.key === "Delete")) return;
  const name = KEYBOARD[event.key] ?? (/^[\d.+\-*/%()]$/.test(event.key) ? event.key : null);
  if (!name) return;
  event.preventDefault();
  key(name);
}

function onPaste(event: ClipboardEvent): void {
  if (elsewhere(event.target)) return;
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text) return;
  event.preventDefault();
  problem.value = null;
  for (const char of text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".").toLowerCase()) {
    if (/^[\d.+\-*/%()kmb]$/.test(char)) entry.value = press(entry.value, char);
  }
}

const cleanup: (() => void)[] = [];

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("paste", onPaste);
  window.addEventListener("focus", reload);
  cleanup.push(
    () => window.removeEventListener("keydown", onKeydown),
    () => window.removeEventListener("paste", onPaste),
    () => window.removeEventListener("focus", reload),
  );
  try {
    const connected = await connectModule(setLanguage);
    history.value = parseHistory(await connected.storage.get(HISTORY_KEY));
    values.value = parseValues(await connected.storage.get(VALUES_KEY));
    settings.value = parseSettings(await connected.storage.app.get(SETTINGS_KEY));
    cleanup.push(connected.lifecycle.onResume(reload));
    sdk.value = connected;
  } catch (reason) {
    error.value = errorMessage(reason);
  }
});

onBeforeUnmount(() => {
  cleanup.forEach((fn) => fn());
  clearTimeout(copiedTimer);
});
</script>

<template>
  <p v-if="!sdk" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="@container flex h-full min-h-0 flex-col" data-testid="calculator-app">
    <div class="flex flex-none items-center gap-2 px-3 pt-2">
      <SegmentedControl v-model="mode" :label="t('mode.label')" :options="modes" />
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="icon-sm"
        :class="settings.history && 'bg-accent text-accent-foreground'"
        :aria-pressed="settings.history"
        :aria-label="t('history.show')"
        :title="t('history.show')"
        data-testid="toggle-history"
        @click="choose({ history: !settings.history })"
      >
        <History :stroke-width="1.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon-sm" :aria-label="t('options.title')" :title="t('options.title')" data-testid="options">
            <Settings2 :stroke-width="1.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="options-decimals">
              {{ t("options.decimals") }}
              <span class="text-muted-foreground ml-auto pl-2">{{ decimalsLabel(settings.decimals) }}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup v-model="decimals">
                <DropdownMenuRadioItem v-for="option in DECIMALS" :key="option" :value="String(option)" :data-testid="`decimals-${option}`">
                  {{ decimalsLabel(option) }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem
            :model-value="settings.short"
            data-testid="options-short"
            @update:model-value="(on: boolean) => choose({ short: on })"
          >
            {{ t("options.short") }}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{{ t("options.historyLength") }}</DropdownMenuLabel>
          <DropdownMenuRadioGroup v-model="historyLength">
            <DropdownMenuRadioItem v-for="option in HISTORY_LENGTHS" :key="option" :value="String(option)" :data-testid="`history-length-${option}`">
              {{ t("options.results", { count: option }) }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <p v-if="saveError" class="text-destructive flex-none px-3 pt-1 text-xs">{{ saveError }}</p>
    <div
      class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-3 @min-[36rem]:flex-row @min-[36rem]:items-start @min-[36rem]:justify-center"
      data-testid="calculator-body"
    >
      <section class="flex w-full max-w-sm flex-[0_1_26rem] flex-col gap-2 @min-[36rem]:h-full @min-[36rem]:max-h-[26rem] @min-[36rem]:min-h-min @min-[36rem]:w-80 @min-[36rem]:flex-none">
        <div class="bg-muted/40 flex flex-none items-start gap-1 rounded-lg border px-3 py-2">
          <div class="min-w-0 flex-1 text-right">
            <p class="truncate font-mono text-3xl tabular-nums" role="group" :aria-label="t('calc.display')" data-testid="display">
              <template v-if="entry.text">
                <span
                  v-for="(segment, index) in segments(entry.fresh ? rounded(entry.text, settings.decimals, settings.short) : entry.text, comma)"
                  :key="index"
                  :class="segment.name !== undefined && (lookupValue(segment.name) === undefined ? 'text-destructive' : 'text-primary')"
                >{{ segment.text }}</span>
              </template>
              <template v-else>0</template>
            </p>
            <p
              class="h-5 truncate text-sm"
              :class="problem || missing ? 'text-destructive' : 'text-muted-foreground'"
              role="status"
              aria-live="polite"
              data-testid="preview"
            >
              {{ problem ?? (missing ? t("error.missing") : preview ? `= ${showResult(preview)}` : "") }}
            </p>
          </div>
          <div class="grid flex-none grid-cols-2">
            <Button
              variant="ghost"
              size="icon-sm"
              class="col-start-2"
              :aria-label="t('calc.back')"
              :title="t('calc.back')"
              :disabled="!entry.text"
              @click="key('back')"
            >
              <Delete :stroke-width="1.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="t('calc.saveAs')"
              :title="t('calc.saveAs')"
              :disabled="savable === null"
              data-testid="save-value"
              @click="valueDialog = {}"
            >
              <BookmarkPlus :stroke-width="1.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="t(copied ? 'calc.copied' : 'calc.copy')"
              :title="t(copied ? 'calc.copied' : 'calc.copy')"
              :disabled="copyable === null"
              data-testid="copy"
              @click="copy"
            >
              <Check v-if="copied" :stroke-width="1.5" />
              <Copy v-else :stroke-width="1.5" />
            </Button>
          </div>
        </div>
        <div class="grid flex-1 grid-cols-4 gap-1.5" :class="ROWS[keys.length]" data-testid="keypad" role="group" :aria-label="t('calc.keypad')">
          <Button
            v-for="item in keys"
            :key="item.key"
            :variant="VARIANT[item.kind]"
            class="h-auto py-0 text-lg"
            :class="item.kind === 'clear' && 'text-destructive hover:text-destructive'"
            :aria-label="item.name ? t(item.name) : undefined"
            :title="item.name ? t(item.name) : undefined"
            :data-testid="`key-${item.key}`"
            :disabled="item.key === 'ans' && !history.length"
            @click="key(item.key)"
          >
            {{ keyLabel(item) }}
          </Button>
        </div>
      </section>

      <section
        v-if="settings.history || values.length"
        class="flex min-h-40 w-full max-w-sm flex-1 flex-col @min-[36rem]:h-full @min-[36rem]:max-h-[26rem]"
        data-testid="history"
      >
        <Tabs v-model="shownTab" class="min-h-0 flex-1 gap-1">
          <div class="flex h-8 flex-none items-center gap-1 border-b">
            <TabsList class="border-b-0">
              <TabsTrigger v-if="settings.history" value="history" data-testid="tab-history">{{ t("history.title") }}</TabsTrigger>
              <TabsTrigger value="values" data-testid="tab-values">{{ t("values.title") }}</TabsTrigger>
            </TabsList>
            <span class="flex-1" />
            <Button
              v-if="shownTab === 'history' && history.length"
              variant="ghost"
              size="icon-sm"
              :aria-label="t('history.clear')"
              :title="t('history.clear')"
              data-testid="clear-history"
              @click="clearing = true"
            >
              <Trash2 :stroke-width="1.5" />
            </Button>
          </div>
          <TabsContent value="history" class="flex min-h-0 flex-col" data-testid="history-list">
            <p v-if="!history.length" class="text-muted-foreground py-2 text-sm">{{ t("history.empty") }}</p>
            <ol v-else class="min-h-0 flex-1 overflow-y-auto">
              <li v-for="(item, index) in recent" :key="`${index}:${item.expression}`">
                <Button
                  variant="ghost"
                  class="block h-auto w-full px-2 py-1 text-right font-normal"
                  :title="t('history.use', { result: showResult(item.result) })"
                  data-testid="history-item"
                  @click="use(item)"
                >
                  <span class="text-muted-foreground block truncate font-mono text-sm">{{ show(item.expression) }} =</span>
                  <span class="block truncate font-mono text-lg tabular-nums">{{ showResult(item.result) }}</span>
                </Button>
              </li>
            </ol>
          </TabsContent>
          <TabsContent value="values" class="flex min-h-0 flex-col" data-testid="values-list">
            <p v-if="!values.length" class="text-muted-foreground py-2 text-sm">{{ t("values.empty") }}</p>
            <ul v-else class="min-h-0 flex-1 overflow-y-auto">
              <li v-for="item in values" :key="item.name" class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  class="h-auto min-w-0 flex-1 justify-between gap-3 px-2 py-1 font-normal"
                  :title="t('values.use', { name: item.name })"
                  data-testid="value-item"
                  @click="tap(item)"
                >
                  <span class="text-primary truncate text-sm">{{ item.name }}</span>
                  <span class="truncate font-mono text-lg tabular-nums">{{ showResult(item.value) }}</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="text-muted-foreground flex-none"
                      :aria-label="t('values.more', { name: item.name })"
                      :title="t('values.more', { name: item.name })"
                      data-testid="value-menu"
                    >
                      <Ellipsis :stroke-width="1.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem data-testid="value-rename" @select="later(() => (valueDialog = { renaming: item.name }))">
                      <Pencil :stroke-width="1.5" />
                      {{ t("values.rename") }}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" data-testid="value-delete" @select="later(() => (deleting = item.name))">
                      <Trash2 :stroke-width="1.5" />
                      {{ t("values.delete") }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            </ul>
          </TabsContent>
        </Tabs>
      </section>
    </div>
    <ConfirmDialog
      v-if="clearing"
      :title="t('history.clearTitle')"
      :description="t('history.clearText')"
      :confirm="t('history.clear')"
      :cancel="t('cancel')"
      @confirm="confirmClear"
      @cancel="clearing = false"
    />
    <ConfirmDialog
      v-if="deleting !== null"
      :title="t('values.deleteTitle', { name: deleting })"
      :description="t('values.deleteText')"
      :confirm="t('values.delete')"
      :cancel="t('cancel')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    />
    <ValueDialog
      v-if="valueDialog && (valueDialog.renaming !== undefined || savable !== null)"
      :values="values"
      :renaming="valueDialog.renaming"
      :shown="valueDialog.renaming === undefined && savable !== null ? showResult(savable) : undefined"
      @submit="submitValue"
      @cancel="valueDialog = null"
    />
  </div>
</template>
