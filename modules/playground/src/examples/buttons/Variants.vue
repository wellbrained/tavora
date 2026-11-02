<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button :disabled="off">Primary</Button>
    <Button variant="secondary" :disabled="off">Secondary</Button>
    <Button variant="outline" :disabled="off">Outline</Button>
    <Button variant="ghost" :disabled="off">Ghost</Button>
    <Button variant="destructive" :disabled="off">Delete for good</Button>
    <Button variant="danger" :disabled="off">Remove</Button>
    <Button variant="link" :disabled="off">Link</Button>
  </div>
</template>
