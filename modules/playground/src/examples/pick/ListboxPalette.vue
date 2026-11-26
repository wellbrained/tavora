<script setup lang="ts">
// The big search list: a Listbox with size="lg", for a picker that is a whole dialog. A frameless search on top, rows
// with a picture, a second line and a hint at the end, groups set off by a line, and the keys in a foot.
import { Listbox, type ListboxOption } from "@tavora/official-ui/components/ui/listbox";
import { ref } from "vue";

const added = ref<string[]>(["reinforced"]);
const RECIPES = [
  { value: "plate", label: "Iron Plate", description: "3 Iron Ingot → 2 Iron Plate", meta: "Constructor", group: "Standard recipes" },
  { value: "rod", label: "Iron Rod", description: "1 Iron Ingot → 1 Iron Rod", meta: "Constructor", group: "Standard recipes" },
  { value: "screw", label: "Screw", description: "1 Iron Rod → 4 Screw", meta: "Constructor", group: "Standard recipes" },
  { value: "reinforced", label: "Reinforced Iron Plate", description: "6 Iron Plate + 12 Screw", meta: "Assembler", group: "Standard recipes" },
  { value: "bolted", label: "Bolted Iron Plate", description: "3 Iron Plate + 12 Screw", meta: "Assembler", group: "Alternate recipes", keywords: "alternate" },
  { value: "coated", label: "Coated Iron Plate", description: "5 Iron Ingot + 1 Plastic", meta: "Assembler", group: "Alternate recipes", keywords: "alternate" },
];
const options = (): ListboxOption[] => RECIPES.map((recipe) => (added.value.includes(recipe.value) ? { ...recipe, disabled: "Already in plan" } : recipe));
const initials = (label: string) => label.split(" ").map((word) => word[0]).join("").slice(0, 2);
</script>

<template>
  <div class="bg-card flex h-96 w-full max-w-lg flex-col overflow-hidden rounded-xl border">
    <Listbox
      :options="options()"
      label="Add a recipe"
      search="Add a recipe"
      size="lg"
      :hints="[{ keys: ['↑', '↓'], label: 'to move' }, { keys: ['Enter'], label: 'to add' }, { keys: ['Esc'], label: 'to close' }]"
      :autofocus="false"
      class="flex-1"
      @pick="(recipe) => added.push(recipe)"
    >
      <template #leading="{ option }">
        <span
          :class="['grid size-8 place-items-center rounded-md text-xs font-semibold', option.group === 'Standard recipes' ? 'bg-primary/15 text-primary' : 'bg-secondary text-secondary-foreground']"
          aria-hidden="true"
        >{{ initials(option.label) }}</span>
      </template>
    </Listbox>
  </div>
</template>
