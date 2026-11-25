<script setup lang="ts">
// A "Share ▸" row for a dropdown menu of your own (a ⋯ menu): its submenu holds the share entries. It opens more
// options, so it has only the submenu arrow, no icon of its own.
import { DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "../dropdown-menu"
import { uiText } from "../text"
import type { ShareMenuProps } from "./share"
import ShareMenuItems from "./ShareMenuItems.vue"

defineProps<ShareMenuProps>()
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger data-testid="share-menu">{{ labels?.share ?? uiText.share }}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      <ShareMenuItems :text="text" :image="image" :name="name" :labels="labels" />
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
