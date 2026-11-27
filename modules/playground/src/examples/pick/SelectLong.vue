<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { ref } from "vue";

const build = ref("long");
const level = ref("early");
const own = ref("long");
const LONG = "Ice Shot Deadeye Leveling Guide for the whole campaign";
</script>

<template>
  <div class="flex w-full max-w-md flex-col items-start gap-3">
    <!-- In a row of controls the value stays on one line; hover or focus the field to read it whole. -->
    <div class="flex w-full items-center gap-1.5" data-testid="select-long-row">
      <Button variant="outline">Add</Button>
      <Select v-model="build">
        <SelectTrigger class="flex-1" aria-label="Build">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="long">{{ LONG }}</SelectItem>
          <SelectItem value="short">Minion Witch</SelectItem>
        </SelectContent>
      </Select>
      <Select v-model="level">
        <SelectTrigger class="w-28" aria-label="Levels">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="early">lvl 1-14</SelectItem>
          <SelectItem value="late">lvl 15-30</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" aria-label="More"><Ellipsis /></Button>
    </div>
    <!-- A field that stands on its own may take a second line. -->
    <Select v-model="own">
      <SelectTrigger class="w-56" aria-label="Build with two lines" data-testid="select-long-wrap">
        <SelectValue wrap />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="long">{{ LONG }}</SelectItem>
        <SelectItem value="short">Minion Witch</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
