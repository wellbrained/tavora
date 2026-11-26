<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
import { ref } from "vue";

const world = ref("one");
const hideDone = ref(false);
</script>

<template>
  <div class="bg-background w-full overflow-hidden rounded-md border">
    <Toolbar label="World" variant="bar">
      <Select v-model="world">
        <SelectTrigger class="w-40" aria-label="World">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">World one</SelectItem>
          <SelectItem value="two">World two</SelectItem>
        </SelectContent>
      </Select>
      <Switch v-model="hideDone" aria-label="Hide done" />
      <Button variant="ghost" size="sm"><Plus /> Add</Button>
      <Button variant="ghost" size="sm">Share</Button>
    </Toolbar>
    <p class="text-muted-foreground p-3 text-sm">Tab goes to the world, the switch, then the tools.</p>
  </div>
</template>
