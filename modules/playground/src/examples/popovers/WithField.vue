<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@tavora/official-ui/components/ui/popover";
import { ref } from "vue";

const name = ref("Waystone");
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="secondary">Rename</Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="flex flex-col gap-2">
      <Input v-model="name" aria-label="Name" />
      <div class="flex justify-end">
        <PopoverClose as-child><Button size="sm">Done</Button></PopoverClose>
      </div>
    </PopoverContent>
  </Popover>
</template>
