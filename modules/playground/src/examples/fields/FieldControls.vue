<script setup lang="ts">
// Any kit control fits in a Field: a number field, a select, a combobox. The Field names it, so the control needs no
// aria-label of its own.
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@tavora/official-ui/components/ui/combobox";
import { Field } from "@tavora/official-ui/components/ui/field";
import { NumberField } from "@tavora/official-ui/components/ui/number-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

const GAMES = ["Path of Exile 2", "Diablo IV", "Satisfactory", "Stardew Valley", "Enshrouded"];
const copies = ref(2);
const sort = ref("recent");
const game = ref<string>();
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field label="Copies" hint="From 1 to 9.">
      <NumberField v-model="copies" :min="1" :max="9" decrease-label="One less" increase-label="One more" />
    </Field>
    <Field label="Sort by">
      <Select v-model="sort">
        <SelectTrigger class="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">Recently changed</SelectItem>
          <SelectItem value="name">Name</SelectItem>
        </SelectContent>
      </Select>
    </Field>
    <Field label="Game" hint="Type to search." :error="game === 'Diablo IV' ? 'Not installed on this PC.' : ''">
      <Combobox v-model="game">
        <ComboboxAnchor class="w-56">
          <ComboboxInput placeholder="Search games" />
        </ComboboxAnchor>
        <ComboboxList>
          <ComboboxEmpty>No game found</ComboboxEmpty>
          <ComboboxItem v-for="item in GAMES" :key="item" :value="item">{{ item }}</ComboboxItem>
        </ComboboxList>
      </Combobox>
    </Field>
  </div>
</template>
