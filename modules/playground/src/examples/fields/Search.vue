<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { ref, useId } from "vue";

defineProps<{ disabled?: boolean }>();

const id = useId();
const search = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label :for="id">Search</Label>
    <SearchInput :id="id" v-model="search" placeholder="Search notes" clear-label="Clear search" :disabled="disabled" />
  </div>
</template>
