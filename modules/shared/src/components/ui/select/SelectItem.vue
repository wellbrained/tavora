<script setup lang="ts">
import type { SelectItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Check } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { SelectItem, SelectItemIndicator, SelectItemText, useForwardProps } from "reka-ui"
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { choiceLabelsKey, EMPTY_CHOICE, emptyChoicesKey } from "./empty"

// `description` is a short line under the name, so each choice says what it does; it shows only in the open list.
const props = defineProps<SelectItemProps & { class?: HTMLAttributes["class"], description?: string }>()

// value="" is the empty choice: the Select clears to "" when it is picked.
const isEmpty = computed(() => props.value === "")
const choices = inject(emptyChoicesKey, null)
onMounted(() => isEmpty.value && choices?.add())
onBeforeUnmount(() => isEmpty.value && choices?.remove())

// Keep the closed select's words current: Reka reads the text once, so watch it ourselves.
const labels = inject(choiceLabelsKey, null)
const text = ref<{ $el?: Element } | null>(null)
const innerValue = computed(() => (isEmpty.value ? EMPTY_CHOICE : props.value))
let observer: MutationObserver | undefined
let published: unknown
function publish() {
  const label = text.value?.$el?.textContent?.trim()
  if (label === undefined) return
  if (published !== undefined && published !== innerValue.value) labels?.remove(published)
  published = innerValue.value
  labels?.set(innerValue.value, label)
}
onMounted(() => {
  publish()
  const element = text.value?.$el
  if (element && labels && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(publish)
    observer.observe(element, { childList: true, characterData: true, subtree: true })
  }
})
watch(innerValue, publish)
onBeforeUnmount(() => {
  observer?.disconnect()
  if (published !== undefined) labels?.remove(published)
})

const delegatedProps = reactiveOmit(props, "class", "value", "description")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectItem
    data-slot="select-item"
    v-bind="forwardedProps"
    :value="isEmpty ? EMPTY_CHOICE : value"
    :class="cn(
      'focus:bg-accent focus:text-accent-foreground [&_svg:not([class*=\'text-\'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
      description && 'items-start py-2 [&_svg]:mt-0.5',
      props.class,
    )"
  >
    <span class="absolute right-2 flex size-3.5 items-center justify-center">
      <SelectItemIndicator>
        <Check class="text-primary size-4" :stroke-width="2" />
      </SelectItemIndicator>
    </span>

    <!-- An optional small picture before the name, such as how a style looks; only the name shows in the closed select. -->
    <slot name="thumb" />
    <span v-if="description" class="flex min-w-0 flex-col gap-0.5">
      <SelectItemText ref="text">
        <slot />
      </SelectItemText>
      <span class="text-muted-foreground text-xs whitespace-normal">{{ description }}</span>
    </span>
    <SelectItemText v-else ref="text">
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
