<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";

const chapters = ["Overview", "Levelling", "Skill gems", "Support gems", "Passive tree", "Ascendancy", "Gear and uniques", "Flasks and charms", "Mapping", "Boss fights", "Farming strategy", "Changelog"];
</script>

<template>
  <Tabs default-value="Overview">
    <TabsList class="max-w-sm flex-wrap" aria-label="Chapters" data-testid="tabs-wrap">
      <TabsTrigger v-for="chapter in chapters" :key="chapter" :value="chapter">{{ chapter }}</TabsTrigger>
    </TabsList>
    <TabsContent v-for="chapter in chapters" :key="chapter" :value="chapter" class="text-muted-foreground text-sm">{{ chapter }}</TabsContent>
  </Tabs>
</template>
