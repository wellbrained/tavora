<script setup lang="ts">
// A Share button with its menu: Copy as text, Copy as image, Save as image, for what you give it. The button opens a
// menu, so it carries the menu arrow after its word; put another button in the `trigger` slot.
// The menu itself draws no element, so `class` and other attributes go on the button.
import { ChevronDown } from "@lucide/vue"
import type { HTMLAttributes } from "vue"
import { Button, type ButtonVariants } from "../button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../dropdown-menu"
import { uiText } from "../text"
import type { ShareMenuProps } from "./share"
import ShareMenuItems from "./ShareMenuItems.vue"

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<ShareMenuProps & {
  /** The button's look and size, as on Button. */
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  /** The button's test id (`share-menu` by default); set one when a panel has two share menus. */
  testid?: string
}>(), { variant: "secondary", testid: "share-menu" })
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot name="trigger">
        <Button :variant="props.variant" :size="props.size" :class="props.class" :data-testid="props.testid" v-bind="$attrs">
          {{ labels?.share ?? uiText.share }} <ChevronDown data-icon="end" />
        </Button>
      </slot>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <ShareMenuItems :text="text" :image="image" :name="name" :labels="labels" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
