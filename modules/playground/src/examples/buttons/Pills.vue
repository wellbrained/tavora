<script setup lang="ts">
// The same controls at your corners and at a corner of 16, where they turn into pills. Round ends give the text a little
// more room and set a leading icon evenly into the curve (pill.css); below a full round nothing changes.
import { Bold, Check, Tag } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Chip } from "@tavora/official-ui/components/ui/chip";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";
import { t } from "../../i18n";

const rows = [
  { id: "yours", label: "demo.pill.yours", round: false },
  { id: "round", label: "demo.pill.round", round: true },
] as const;
const words = { bold: "demo.pill.bold", forest: "demo.pill.forest", name: "demo.pill.name" } as const;
const bold = ref(true);
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="pills">
    <div v-for="row in rows" :key="row.id" class="flex flex-col gap-1.5" :class="row.round && 'playground-radius-16'" :data-testid="`pills-${row.id}`">
      <p class="text-muted-foreground text-xs">{{ t(row.label) }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <Button variant="secondary">{{ t("demo.pill.approve") }}</Button>
        <Button><Check /> {{ t("demo.pill.approve") }}</Button>
        <Toggle v-model="bold" :label="t(words.bold)"><Bold /> {{ t(words.bold) }}</Toggle>
        <Chip :label="t(words.forest)"><template #icon><Tag /></template></Chip>
        <Badge variant="success"><Tag /> {{ t(words.forest) }}</Badge>
        <Input :placeholder="t(words.name)" class="w-32" />
      </div>
    </div>
  </div>
</template>
