<script setup lang="ts">
// The language choice: a button showing the current one, and under it a list
// with a search field on top. Follow System comes first; the languages follow
// in their own names. Typing narrows the list by name or code, Enter picks the
// first match.
import { Check, ChevronDown, Search } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import { LANGUAGES, type LanguageSetting } from "../../../shared/i18n";
import { useFloating } from "../../host";
import { t } from "../../i18n";

const model = defineModel<LanguageSetting>({ required: true });

const open = ref(false);
const query = ref("");
const track = useFloating();
const search = ref<HTMLInputElement | null>(null);

interface Option {
  value: LanguageSetting;
  label: string;
  /** Words that find the option, besides its label. */
  words: string;
}

const options = computed<Option[]>(() => [
  { value: "system", label: t("settings.language.system"), words: "system follow auto automatic" },
  ...LANGUAGES.map((item) => ({ value: item.id, label: item.name, words: `${item.id} ${item.search}` })),
]);

const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  return text ? options.value.filter((option) => `${option.label} ${option.words}`.toLowerCase().includes(text)) : options.value;
});
const current = computed(() => options.value.find((option) => option.value === model.value) ?? options.value[0]!);

watch(open, (isOpen) => {
  track(isOpen);
  if (isOpen) query.value = "";
});

function pick(value: LanguageSetting) {
  open.value = false;
  if (value !== model.value) model.value = value;
}

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Enter" && shown.value[0]) {
    event.preventDefault();
    pick(shown.value[0].value);
  }
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="secondary" class="min-w-44 justify-between" :aria-label="t('settings.language.label')" data-testid="language-picker">
        <span class="truncate">{{ current.label }}</span>
        <ChevronDown class="size-4 flex-none" :stroke-width="1.5" />
      </Button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="6"
        :collision-padding="8"
        class="bg-popover text-popover-foreground z-50 w-64 overflow-hidden rounded-lg border shadow-lg"
        data-testid="language-menu"
        @open-auto-focus.prevent="search?.focus()"
      >
        <div class="relative border-b">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
          <input
            ref="search"
            v-model="query"
            type="text"
            class="placeholder:text-muted-foreground h-10 w-full bg-transparent pr-3 pl-9 text-sm focus-visible:outline-none"
            :placeholder="t('settings.language.searchPlaceholder')"
            :aria-label="t('settings.language.searchPlaceholder')"
            autocomplete="off"
            spellcheck="false"
            maxlength="40"
            data-testid="language-search"
            @keydown="onSearchKey"
          />
        </div>
        <ul class="max-h-60 overflow-y-auto p-1" role="listbox" :aria-label="t('settings.language.label')">
          <li v-for="option in shown" :key="option.value" role="presentation">
            <button
              type="button"
              role="option"
              :aria-selected="option.value === model"
              :class="cn('hover:bg-accent focus-visible:bg-accent flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm', option.value === model && 'font-medium')"
              :data-testid="`language-option-${option.value}`"
              @click="pick(option.value)"
            >
              <span class="flex-1 truncate">{{ option.label }}</span>
              <Check v-if="option.value === model" class="text-primary size-4 flex-none" :stroke-width="1.5" />
            </button>
          </li>
          <li v-if="!shown.length" class="text-muted-foreground px-3 py-3 text-sm" data-testid="language-none">{{ t("settings.language.none") }}</li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
