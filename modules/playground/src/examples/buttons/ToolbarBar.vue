<script setup lang="ts">
import { ArrowUpDown, ChevronDown, ChevronUp, Ellipsis, FoldVertical, ListFilter, Minus, PanelLeft, Plus, Settings, ZoomIn } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
import { ref } from "vue";

const search = ref("");
const filtering = ref(true);
const pages = ref(true);
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <div class="bg-background overflow-hidden rounded-md border">
      <Toolbar label="Tasks" variant="bar">
        <p class="text-muted-foreground min-w-0 flex-1 truncate px-1 text-xs tabular-nums">4 open</p>
        <Button variant="ghost" size="icon-sm" aria-label="Fold all" title="Fold all"><FoldVertical /></Button>
        <Button variant="ghost" size="sm"><Plus /> Add list</Button>
        <Button variant="ghost" size="icon-sm" aria-label="More" title="More"><Ellipsis /></Button>
      </Toolbar>
      <p class="text-muted-foreground p-3 text-sm">Buy potions · Clear the keep · Sell loot</p>
    </div>

    <div class="bg-background overflow-hidden rounded-md border">
      <Toolbar label="Search" variant="bar">
        <SearchInput v-model="search" class="min-w-0 flex-1" placeholder="Search cards" aria-label="Search cards" clear-label="Clear" />
        <Toggle v-model="filtering" variant="ghost" label="Filters"><ListFilter /></Toggle>
        <Button variant="ghost" size="icon" aria-label="Sort" title="Sort"><ArrowUpDown /></Button>
        <Button variant="ghost" size="icon" aria-label="Settings" title="Settings"><Settings /></Button>
        <template #below>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="secondary" numeric>12 shown</Badge>
            <Badge variant="secondary" numeric>3 locked</Badge>
            <Button variant="link" size="xs" class="ml-auto h-auto p-0" @click="filtering = false">Clear filters</Button>
          </div>
        </template>
      </Toolbar>
      <p class="text-muted-foreground p-3 text-sm">King of Nothing · King of Spells · …</p>
    </div>

    <div class="bg-background max-w-[340px] overflow-hidden rounded-md border">
      <Toolbar label="Document" variant="bar" wrap>
        <Toggle v-model="pages" variant="ghost" label="Pages"><PanelLeft /></Toggle>
        <Button variant="ghost" size="icon" aria-label="Previous page" title="Previous page"><ChevronUp /></Button>
        <Button variant="ghost" size="icon" aria-label="Next page" title="Next page"><ChevronDown /></Button>
        <span class="text-muted-foreground px-1 text-sm tabular-nums">3 of 12</span>
        <Separator />
        <Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out"><Minus /></Button>
        <span class="text-sm tabular-nums">100%</span>
        <Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in"><ZoomIn /></Button>
      </Toolbar>
      <p class="text-muted-foreground p-3 text-sm">Page 3</p>
    </div>
  </div>
</template>
