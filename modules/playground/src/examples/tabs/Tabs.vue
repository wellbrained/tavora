<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <Tabs default-value="overview">
    <TabsList>
      <TabsTrigger value="overview" :disabled="off">Overview</TabsTrigger>
      <TabsTrigger value="skills" :disabled="off">Skills</TabsTrigger>
      <TabsTrigger value="gear" :disabled="off">Gear</TabsTrigger>
      <TabsTrigger value="locked" disabled>Locked</TabsTrigger>
    </TabsList>
    <TabsContent value="overview" class="text-muted-foreground text-sm">The build at a glance.</TabsContent>
    <TabsContent value="skills" class="text-muted-foreground text-sm">Skill gems and supports.</TabsContent>
    <TabsContent value="gear" class="text-muted-foreground text-sm">What to wear, slot by slot.</TabsContent>
  </Tabs>
</template>
