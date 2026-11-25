<script setup lang="ts">
// A Share button with its menu: Copy as text, Copy as image, Save as image, for what you give it. The button opens a
// menu, so it carries the menu arrow after its word; put another button in the `trigger` slot.
import { ChevronDown } from "@lucide/vue"
import { Button } from "../button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../dropdown-menu"
import { uiText } from "../text"
import type { ShareMenuProps } from "./share"
import ShareMenuItems from "./ShareMenuItems.vue"

defineProps<ShareMenuProps>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot name="trigger">
        <Button variant="secondary" data-testid="share-menu">{{ labels?.share ?? uiText.share }} <ChevronDown /></Button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <ShareMenuItems :text="text" :image="image" :name="name" :labels="labels" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
