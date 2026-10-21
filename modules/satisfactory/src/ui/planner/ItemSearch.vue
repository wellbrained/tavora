<script setup lang="ts">
// Type to find an item; picking one hands it on and clears the field.
// The module ranks the matches itself, so the kit's own filter is off.
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@tavora/official-ui/components/ui/combobox";
import { computed, ref } from "vue";
import { language, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule } from "../context";
import { search } from "../search";

const props = defineProps<{ label: string; filter?: (item: string) => boolean }>();
const emit = defineEmits<{ pick: [item: string] }>();

const { services } = useModule();
const query = ref("");
const picked = ref<string>();

const hits = computed(() =>
  query.value.trim()
    ? search(services.data, query.value, language.value, { kinds: ["item"], limit: 12, filter: (entry) => !props.filter || props.filter(entry.id) })
    : [],
);

function pick(item: string | undefined) {
  if (!item) return;
  emit("pick", item);
  picked.value = undefined;
  query.value = "";
}
</script>

<template>
  <Combobox :model-value="picked" ignore-filter :open="query.trim().length > 0" @update:model-value="pick($event as string | undefined)">
    <ComboboxAnchor>
      <ComboboxInput v-model="query" :display-value="() => ''" :placeholder="label" :aria-label="label" data-testid="item-search" />
    </ComboboxAnchor>
    <ComboboxList>
      <ComboboxEmpty>{{ t("search.noItems") }}</ComboboxEmpty>
      <ComboboxItem v-for="hit in hits" :key="hit.id" :value="hit.id" :text-value="hit.name" data-testid="item-option">
        <GameIcon :icon="services.data.items[hit.id]?.icon" :size="20" />
        <span class="min-w-0 truncate">{{ hit.name }}</span>
      </ComboboxItem>
    </ComboboxList>
  </Combobox>
</template>
