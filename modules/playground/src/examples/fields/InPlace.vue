<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { ref } from "vue";

const title = ref("Raid night checklist");
const group = ref("This week");
const task = ref("Farm silver for the boss fight and refill the potion chest before Friday evening");
const next = ref("");
</script>

<template>
  <div class="flex max-w-96 flex-col gap-2">
    <Input v-model="title" variant="bare" class="h-auto px-1 py-0.5 text-xl font-semibold" aria-label="Title" data-testid="input-bare" />
    <Input v-model="group" variant="bare" size="sm" class="px-1 text-sm font-semibold" aria-label="Group name" />
    <Textarea v-model="task" variant="bare" autosize class="px-1 py-1 text-sm" aria-label="To-do" data-testid="textarea-autosize" />
    <span class="relative flex items-center">
      <Plus class="text-muted-foreground pointer-events-none absolute left-2 size-4" aria-hidden="true" />
      <Input v-model="next" variant="bare" class="pl-8 text-sm" placeholder="Add a to-do" aria-label="Add a to-do" />
    </span>
  </div>
</template>
