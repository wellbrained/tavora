<script setup lang="ts" generic="T extends string">
// A choice from a list too long or too changeable for a SegmentedControl: a button showing the current
// one, and under it the list. Shaped like LanguagePicker, without its search.
import { Check, ChevronDown } from "@lucide/vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFloating } from "../../host";

const props = defineProps<{ options: { value: T; label: string }[]; label: string; testid: string }>();
const model = defineModel<T>({ required: true });

const open = ref(false);
const track = useFloating();
const current = computed(() => props.options.find((option) => option.value === model.value) ?? props.options[0]);

watch(open, (isOpen) => track(isOpen));

function pick(value: T) {
  open.value = false;
  if (value !== model.value) model.value = value;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="secondary" class="max-w-56 min-w-44 justify-between" :aria-label="label" :data-testid="testid">
        <span class="truncate">{{ current?.label }}</span>
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
        :data-testid="`${testid}-menu`"
      >
        <ul class="max-h-60 overflow-y-auto p-1" role="listbox" :aria-label="label">
          <li v-for="option in options" :key="option.value" role="presentation">
            <button
              type="button"
              role="option"
              :aria-selected="option.value === model"
              :class="cn('hover:bg-accent focus-visible:bg-accent flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm', option.value === model && 'font-medium')"
              :data-testid="`${testid}-option-${option.value}`"
              @click="pick(option.value)"
            >
              <span class="flex-1 truncate">{{ option.label }}</span>
              <Check v-if="option.value === model" class="text-primary size-4 flex-none" :stroke-width="1.5" />
            </button>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
