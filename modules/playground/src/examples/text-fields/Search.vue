<script setup lang="ts">
import { Label } from "@tavora/official-ui/components/ui/label";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const search = ref("");
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Label for="pg-search">Search</Label>
    <SearchInput id="pg-search" v-model="search" placeholder="Search notes" clear-label="Clear search" :disabled="off" />
  </div>
</template>
