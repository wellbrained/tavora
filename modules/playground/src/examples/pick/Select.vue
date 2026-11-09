<script setup lang="ts">
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

const game = ref("poe2");
const long = ref("a");
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Select v-model="game">
      <SelectTrigger class="w-56" aria-label="Game">
        <SelectValue placeholder="Pick a game" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Favorites</SelectLabel>
          <SelectItem value="poe2">Path of Exile 2</SelectItem>
          <SelectItem value="d4">Diablo IV</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Other games</SelectLabel>
          <SelectItem value="ff14">Final Fantasy XIV</SelectItem>
          <SelectItem value="gw2">Guild Wars 2</SelectItem>
          <SelectItem value="wow" disabled>World of Warcraft (not installed)</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <Select>
      <SelectTrigger size="sm" class="w-40" aria-label="Sort by">
        <SelectValue placeholder="Sort by" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="recent">Recently changed</SelectItem>
        <SelectItem value="name">Name</SelectItem>
      </SelectContent>
    </Select>
    <!-- A long choice wraps between words and ends in an ellipsis; the field grows a line instead of squeezing it. -->
    <Select v-model="long">
      <SelectTrigger class="w-40" aria-label="Long choice">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">A rather long choice that needs several lines to be read in full</SelectItem>
        <SelectItem value="b">Short</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
