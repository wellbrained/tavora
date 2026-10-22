<script setup lang="ts">
// Calculator: the sum and its result as you type, a keypad laid out like the Windows one (the keyboard works too, with
// its shortcuts @ for √, q for x² and F9 for ±), Copy, and the game's last results.
// The keypad keeps a calculator size; the history sits below it in a tall panel and beside it in a wide one.
// The history lives in the game's module storage, so every panel of the game shares it; a panel reads it again
// when it shows or gets focus, since storage has no change events.
import { Check, Copy, Delete, Trash2 } from "@lucide/vue";
import { connectModule, errorMessage, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { copyText, EMPTY, evaluate, format, insert, press, pretty, type Entry } from "./calc";
import { HISTORY_KEY, parseHistory, remember, type Calculation } from "./history";
import { language, setLanguage, t } from "./i18n";
import type { en } from "./locales";

type Key = { key: string; label: string; name?: keyof typeof en; kind: "digit" | "op" | "clear" | "equals" };

const KEYS: Key[] = [
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  { key: "sqrt", label: "√", name: "calc.sqrt", kind: "op" },
  { key: "square", label: "x²", name: "calc.square", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...["7", "8", "9"].map((key) => ({ key, label: key, kind: "digit" as const })),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...["4", "5", "6"].map((key) => ({ key, label: key, kind: "digit" as const })),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  ...["1", "2", "3"].map((key) => ({ key, label: key, kind: "digit" as const })),
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
const entry = ref<Entry>(EMPTY);
/** Why the last Equals did not work, until the next key. */
const problem = ref<string | null>(null);
const history = ref<Calculation[]>([]);
/** Copy just worked: its button shows a tick for a moment. */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const queue = serial();

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
  <div v-else class="@container h-full min-h-0" data-testid="calculator-app">
    <div class="flex h-full min-h-0 flex-col items-center gap-3 p-3 landscape:flex-row landscape:items-start landscape:justify-center">
      <section class="flex min-h-0 w-full max-w-sm flex-[0_1_26rem] flex-col gap-2 landscape:h-full landscape:max-h-[26rem] landscape:w-80 landscape:flex-none">
        <div class="bg-muted/40 flex flex-none items-start gap-1 rounded-lg border px-3 py-2">
          <div class="min-w-0 flex-1 text-right" role="status" aria-live="polite" :aria-label="t('calc.display')">
            <p class="truncate font-mono text-3xl tabular-nums" data-testid="display">{{ show(entry.text) || "0" }}</p>
            <p class="h-5 truncate text-sm" :class="problem ? 'text-destructive' : 'text-muted-foreground'" data-testid="preview">
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
        <div class="grid min-h-0 flex-1 grid-cols-4 grid-rows-6 gap-1.5" role="group" :aria-label="t('calc.keypad')">
          <Button
            v-for="item in KEYS"
            :key="item.key"
            :variant="VARIANT[item.kind]"
            class="h-auto min-h-8 text-lg"
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

      <section class="flex min-h-24 w-full max-w-sm flex-1 flex-col gap-1 landscape:h-full landscape:max-h-[26rem] landscape:min-h-0" data-testid="history">
        <header class="flex h-8 flex-none items-center gap-1">
          <h2 class="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium">{{ t("history.title") }}</h2>
          <Button
            v-if="history.length"
            variant="ghost"
            size="icon-sm"
            :aria-label="t('history.clear')"
            :title="t('history.clear')"
            data-testid="clear-history"
            @click="save(() => [])"
          >
            <Trash2 :stroke-width="1.5" />
          </Button>
        </header>
        <p v-if="saveError" class="text-destructive text-xs">{{ saveError }}</p>
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
  </div>
</template>
