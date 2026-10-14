<script setup lang="ts">
// Stands where a module panel's native view is drawn. The view covers it,
// so this only shows while the view is hidden: a still image of the module
// during menus and drags, or the module's name and state.
import type { IDockviewPanelProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { frozen, state } from "../../host";
import { DOCK } from "./dock-context";

const props = defineProps<{ params: IDockviewPanelProps }>();
const dock = inject(DOCK)!;
const id = props.params.api.id;
const element = ref<HTMLElement | null>(null);
const panel = computed(() => state.value?.panels.find((item) => item.instanceId === id));
const image = computed(() => frozen.value[id]);

onMounted(() => dock.register(id, element.value!));
onBeforeUnmount(() => dock.unregister(id, element.value!));
</script>

<template>
  <div ref="element" class="relative size-full overflow-hidden" :data-testid="`panel-content-${id}`">
    <img v-if="image" :src="image" alt="" class="absolute inset-0 size-full" draggable="false" />
    <div v-else class="text-muted-foreground flex size-full items-center justify-center p-4 text-center">
      {{ panel?.name }}
    </div>
  </div>
</template>
