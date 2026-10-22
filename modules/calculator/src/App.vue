<script setup lang="ts">
// Calculator: the sum and its result as you type, a keypad (the keyboard works too), and the game's last results.
// The history lives in the game's module storage, so every panel of the game shares it; a panel reads it again
// when it shows or gets focus, since storage has no change events.
import { Delete, Trash2 } from "@lucide/vue";
import { connectModule, errorMessage, serial } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { EMPTY, evaluate, format, insert, press, pretty, type Entry } from "./calc";
import { HISTORY_KEY, parseHistory, remember, type Calculation } from "./history";
import { language, setLanguage, t } from "./i18n";
import type { en } from "./locales";

type Key = { key: string; label: string; name?: keyof typeof en; kind: "digit" | "op" | "clear" | "equals" };

const KEYS: Key[] = [
  { key: "clear", label: "C", name: "calc.clear", kind: "clear" },
  { key: "(", label: "(", name: "calc.open", kind: "op" },
  { key: ")", label: ")", name: "calc.close", kind: "op" },
  { key: "/", label: "÷", name: "calc.divide", kind: "op" },
  ...["7", "8", "9"].map((key) => ({ key, label: key, kind: "digit" as const })),
  { key: "*", label: "×", name: "calc.times", kind: "op" },
  ...["4", "5", "6"].map((key) => ({ key, label: key, kind: "digit" as const })),
  { key: "-", label: "−", name: "calc.minus", kind: "op" },
  ...["1", "2", "3"].map((key) => ({ key, label: key, kind: "digit" as const })),
  { key: "+", label: "+", name: "calc.plus", kind: "op" },
  { key: "%", label: "%", name: "calc.percent", kind: "op" },
  { key: "0", label: "0", kind: "digit" },
  { key: ".", label: ".", name: "calc.point", kind: "digit" },
  { key: "=", label: "=", name: "calc.equals", kind: "equals" },
];

const VARIANT = { digit: "secondary", op: "outline", clear: "danger", equals: "default" } as const;

const sdk = shallowRef<TavoraSDK | null>(null);
const error = ref<string | null>(null);
const saveError = ref<string | null>(null);
const entry = ref<Entry>(EMPTY);
/** Why the last Equals did not work, until the next key. */
const problem = ref<string | null>(null);
const history = ref<Calculation[]>([]);
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
  entry.value = press(entry.value, name);
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
};

function onKeydown(event: KeyboardEvent): void {
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

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>

<template>
  <p v-if="!sdk" class="text-muted-foreground p-4 text-sm" data-testid="status">
    {{ error ? t("connectError", { error }) : t("loading") }}
  </p>
  <div v-else class="@container h-full min-h-0" data-testid="calculator-app">
    <div class="flex h-full min-h-0 flex-col gap-3 p-3 @[34rem]:flex-row">
      <section class="flex min-h-0 flex-[3] flex-col gap-2 @[34rem]:max-w-md">
        <div class="bg-muted/40 flex flex-none items-start gap-1 rounded-lg border px-3 py-2">
          <div class="min-w-0 flex-1 text-right" role="status" aria-live="polite" :aria-label="t('calc.display')">
            <p class="truncate font-mono text-2xl tabular-nums" data-testid="display">{{ show(entry.text) || "0" }}</p>
            <p class="h-5 truncate text-sm" :class="problem ? 'text-destructive' : 'text-muted-foreground'" data-testid="preview">
              {{ problem ?? (preview ? `= ${show(preview)}` : "") }}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" :aria-label="t('calc.back')" :title="t('calc.back')" :disabled="!entry.text" @click="key('back')">
            <Delete :stroke-width="1.5" />
          </Button>
        </div>
        <div class="grid min-h-0 flex-1 grid-cols-4 grid-rows-5 gap-1.5" role="group" :aria-label="t('calc.keypad')">
          <Button
            v-for="item in KEYS"
            :key="item.key"
            :variant="VARIANT[item.kind]"
            class="h-auto min-h-8 text-base"
            :aria-label="item.name ? t(item.name) : undefined"
            :title="item.name ? t(item.name) : undefined"
            :data-testid="`key-${item.key}`"
            @click="key(item.key)"
          >
            {{ keyLabel(item) }}
          </Button>
        </div>
      </section>

      <section class="flex max-h-[40%] min-h-0 flex-[2] flex-col gap-1 @[34rem]:max-h-none" data-testid="history">
        <header class="flex h-7 flex-none items-center gap-1">
          <h2 class="text-muted-foreground min-w-0 flex-1 truncate text-xs font-medium">{{ t("history.title") }}</h2>
          <Button
            v-if="history.length"
            variant="ghost"
            size="icon-xs"
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
              <span class="text-muted-foreground block truncate font-mono text-xs">{{ show(item.expression) }} =</span>
              <span class="block truncate font-mono text-sm tabular-nums">{{ show(item.result) }}</span>
            </Button>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>
