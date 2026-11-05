<script setup lang="ts">
// SliderField shows its value at the end. `editable` turns the value into a box you can type in; `resetValue` adds a
// Reset button that shows while the value differs. When a row is too narrow the box moves under the slider.
import { SliderField } from "@tavora/official-ui/components/ui/slider";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const plain = ref(70);
const editable = ref(70);
const withReset = ref(40);
const narrow = ref(40);
const narrower = ref(40);
const opacity = computed(() => t("demo.slider.opacity"));
const reset = computed(() => t("demo.slider.reset"));
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.slider.plain") }}</span>
      <SliderField v-model="plain" :min="0" :max="100" :step="5" unit="%" :label="opacity" class="max-w-56" />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.slider.editable") }}</span>
      <SliderField v-model="editable" editable :min="0" :max="100" :step="5" unit="%" :label="opacity" class="max-w-56" />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.slider.editableReset") }}</span>
      <SliderField v-model="withReset" editable :reset-value="70" :reset-label="reset" :min="0" :max="100" :step="5" unit="%" :label="opacity" class="max-w-80" />
    </div>
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.slider.narrow") }}</span>
      <SliderField v-model="narrow" editable :reset-value="70" :reset-label="reset" :min="0" :max="100" :step="5" unit="%" :label="opacity" class="w-56" />
      <SliderField v-model="narrower" editable :reset-value="70" :reset-label="reset" :min="0" :max="100" :step="5" unit="%" :label="opacity" class="w-44" />
    </div>
  </div>
</template>
