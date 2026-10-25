<script setup lang="ts">
// Calculator: the sum and its result as you type, a keypad (the keyboard works too, with the Windows shortcuts @ for √,
// q for x² and F9 for ±), Copy, and the game's last results. The toolbar switches between the Basic keypad and Plus,
// which is laid out like the Windows one, and shows or hides the history; both choices hold in every game.
// The keypad keeps a calculator size: its keys never shrink below a button nor grow past a big one. The history sits
// beside it once the panel is wide enough for both, else below; a panel too short for both scrolls.
// The history lives in the game's module storage, so every panel of the game shares it; a panel reads it again
// when it shows or gets focus, since storage has no change events.
import { Check, Copy, Delete, History, Trash2 } from "@lucide/vue";
import { ConfirmDialog, connectModule, errorMessage, SegmentedControl, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { copyText, EMPTY, evaluate, format, insert, press, pretty, type Entry } from "./calc";
import { HISTORY_KEY, parseHistory, remember, type Calculation } from "./history";
import { language, setLanguage, t } from "./i18n";
import type { en } from "./locales";
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, type Mode, type Settings } from "./settings";

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

/** Laid out like the Windows calculator, with √, x², ± and ans. */
const PLUS: Key[] = [
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

const sdk = shallowRef<TavoraSDK | null>(null);
const error = ref<string | null>(null);
const saveError = ref<string | null>(null);
/** Clear history asked, waiting for the player to confirm. */
const clearing = ref(false);
const entry = ref<Entry>(EMPTY);
/** Why the last Equals did not work, until the next key. */
const problem = ref<string | null>(null);
const history = ref<Calculation[]>([]);
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
const keyLabel = (key: Key) => (key.key === "." && comma.value ? "," : key.label);

/** The result so far, shown under the sum while typing. */
const preview = computed(() => {
  if (entry.value.fresh) return "";
  const outcome = evaluate(entry.value.text);
  if (!outcome.ok) return "";
  const result = format(outcome.value);
  return result === entry.value.text ? "" : result;
});

function key(name: string): void {
  problem.value = null;
  if (name === "=") return equals();
  if (name === "ans") return void (history.value[0] && use(history.value[0]));
  entry.value = press(entry.value, name);
}

/** The result as Copy writes it, or null while there is none. */
const copyable = computed(() => copyText(entry.value, comma.value));

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
  const outcome = evaluate(text);
  if (!outcome.ok) {
    problem.value = t(`error.${outcome.reason}`);
    return;
  }
  const result = format(outcome.value);
  entry.value = { text: result, fresh: true };
  if (result !== text) save((items) => remember(items, { expression: text, result }));
}

function use(calculation: Calculation): void {
  problem.value = null;
  entry.value = insert(entry.value, calculation.result);
}

// ── History ──────────────────────────────────────────────────────────

/** Reads the newest history, changes it and writes it back, one save at a time. */
function save(change: (items: Calculation[]) => Calculation[]): void {
  history.value = change(history.value);
  void queue(async () => {
    const connected = sdk.value;
    if (!connected) return;
    try {
      const next = change(parseHistory(await connected.storage.get(HISTORY_KEY)));
      await connected.storage.set(HISTORY_KEY, next.map((item) => ({ ...item })));
      history.value = next;
      saveError.value = null;
    } catch (reason) {
      saveError.value = t("saveError", { error: errorMessage(reason) });
    }
  });
}

function confirmClear(): void {
  clearing.value = false;
  save(() => []);
}

function reload(): void {
  void queue(async () => {
    const stored = await sdk.value?.storage.get(HISTORY_KEY).catch(() => undefined);
    if (stored !== undefined) history.value = parseHistory(stored);
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
};

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
    event.preventDefault();
    return void copy();
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // A focused button or option keeps its own Enter, so the keyboard can still press it; a dialog keeps its keys.
  const focused = event.target instanceof HTMLElement && event.target.closest("button, [role='radio'], [role='dialog']");
  if (focused && (event.key === "Enter" || event.key === "Escape" || event.key === "Backspace" || event.key === "Delete")) return;
  const name = KEYBOARD[event.key] ?? (/^[\d.+\-*/%()]$/.test(event.key) ? event.key : null);
  if (!name) return;
  event.preventDefault();
  key(name);
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text) return;
  event.preventDefault();
  problem.value = null;
  for (const char of text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/,/g, ".")) {
    if (/^[\d.+\-*/%()]$/.test(char)) entry.value = press(entry.value, char);
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
    </div>
    <p v-if="saveError" class="text-destructive flex-none px-3 pt-1 text-xs">{{ saveError }}</p>
    <div
      class="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-3 @min-[36rem]:flex-row @min-[36rem]:items-start @min-[36rem]:justify-center"
      data-testid="calculator-body"
    >
      <section class="flex w-full max-w-sm flex-[0_1_26rem] flex-col gap-2 @min-[36rem]:h-full @min-[36rem]:max-h-[26rem] @min-[36rem]:min-h-min @min-[36rem]:w-80 @min-[36rem]:flex-none">
        <div class="bg-muted/40 flex flex-none items-start gap-1 rounded-lg border px-3 py-2">
          <div class="min-w-0 flex-1 text-right">
            <p class="truncate font-mono text-3xl tabular-nums" role="group" :aria-label="t('calc.display')" data-testid="display">{{ show(entry.text) || "0" }}</p>
            <p class="h-5 truncate text-sm" :class="problem ? 'text-destructive' : 'text-muted-foreground'" role="status" aria-live="polite" data-testid="preview">
              {{ problem ?? (preview ? `= ${show(preview)}` : "") }}
            </p>
          </div>
          <div class="flex flex-none flex-col">
            <Button variant="ghost" size="icon-sm" :aria-label="t('calc.back')" :title="t('calc.back')" :disabled="!entry.text" @click="key('back')">
              <Delete :stroke-width="1.5" />
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
        <div
          class="grid flex-1 grid-cols-4 gap-1.5"
          :class="keys.length > 20 ? 'grid-rows-[repeat(6,minmax(2rem,1fr))]' : 'grid-rows-[repeat(5,minmax(2rem,1fr))]'"
          data-testid="keypad"
          role="group"
          :aria-label="t('calc.keypad')"
        >
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
        v-if="settings.history"
        class="flex min-h-40 w-full max-w-sm flex-1 flex-col gap-1 @min-[36rem]:h-full @min-[36rem]:max-h-[26rem]"
        data-testid="history"
      >
        <header class="flex h-8 flex-none items-center gap-1">
          <h2 class="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium">{{ t("history.title") }}</h2>
          <Button
            v-if="history.length"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('history.clear')"
            :title="t('history.clear')"
            data-testid="clear-history"
            @click="clearing = true"
          >
            <Trash2 :stroke-width="1.5" />
          </Button>
        </header>
        <p v-if="!history.length" class="text-muted-foreground py-2 text-sm">{{ t("history.empty") }}</p>
        <ol v-else class="min-h-0 flex-1 overflow-y-auto">
          <li v-for="(item, index) in history" :key="`${index}:${item.expression}`">
            <Button
              variant="ghost"
              class="block h-auto w-full px-2 py-1 text-right font-normal"
              :title="t('history.use', { result: show(item.result) })"
              data-testid="history-item"
              @click="use(item)"
            >
              <span class="text-muted-foreground block truncate font-mono text-sm">{{ show(item.expression) }} =</span>
              <span class="block truncate font-mono text-lg tabular-nums">{{ show(item.result) }}</span>
            </Button>
          </li>
        </ol>
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
  </div>
</template>
