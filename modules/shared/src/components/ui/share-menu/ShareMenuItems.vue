<script setup lang="ts">
// The share entries as plain rows, for a DropdownMenuContent or a DropdownMenuSubContent of your own: Copy as text when
// there is text, Copy as image and Save as image when there is a picture. Each row stays busy until it is done, and a
// toast says how it went. The picture starts as the rows show, so it is ready by the click.
import { ClipboardType, Image, ImageDown } from "@lucide/vue"
import { onBeforeUnmount, onMounted } from "vue"
import { DropdownMenuItem } from "../dropdown-menu"
import { uiText } from "../text"
import { createShare, type ShareLabels, type ShareSource } from "./share"

const props = defineProps<ShareSource & {
  /** The rows' own words, when the defaults don't fit. */
  labels?: Partial<ShareLabels>
}>()

const share = createShare(() => props)
onMounted(share.prepare)
onBeforeUnmount(share.forget)
</script>

<template>
  <DropdownMenuItem v-if="text" data-testid="share-copy-text" :action="share.copyAsText">
    <ClipboardType /> {{ labels?.copyText ?? uiText.shareCopyText }}
  </DropdownMenuItem>
  <template v-if="image">
    <DropdownMenuItem data-testid="share-copy-image" :action="share.copyAsImage">
      <Image /> {{ labels?.copyImage ?? uiText.shareCopyImage }}
    </DropdownMenuItem>
    <DropdownMenuItem data-testid="share-save-image" :action="share.saveAsImage">
      <ImageDown /> {{ labels?.saveImage ?? uiText.shareSaveImage }}
    </DropdownMenuItem>
  </template>
</template>
