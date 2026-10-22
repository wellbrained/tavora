<script setup lang="ts">
// Which alternate recipes a world has unlocked: a searchable checklist grouped
// by product, and a switch to plan as if all were unlocked.
import { Search } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed, ref, useId } from "vue";
import type { World } from "../../contracts/plan";
import { language, locale, plural, t } from "../../i18n";
import { alternateGroups } from "../alternates";
import GameIcon from "../common/GameIcon.vue";
import { useModule } from "../context";
import { recipeTooltip } from "../tooltip";

const props = defineProps<{ world: World }>();
const emit = defineEmits<{ toggle: [recipe: string, unlocked: boolean]; showAll: [on: boolean]; close: [] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const query = ref("");
const switchId = useId();

const total = computed(() => Object.values(data.recipes).filter((recipe) => recipe.alternate).length);
const unlockedCount = computed(() => props.world.unlockedAlternates.filter((id) => data.recipes[id]?.alternate).length);
const groups = computed(() => alternateGroups(data, language.value, query.value));
const unlocked = computed(() => new Set(props.world.unlockedAlternates));
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="top-[6vh] flex max-h-[88vh] translate-y-0 flex-col gap-3 sm:max-w-[480px]" data-testid="alternates-dialog">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("alt.title") }}</DialogTitle>
        <DialogDescription>{{ t("alt.description", { world: world.name }) }}</DialogDescription>
      </DialogHeader>

      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <label :for="switchId" class="text-sm font-medium">{{ t("alt.showAll") }}</label>
          <p class="text-muted-foreground text-xs">{{ t("alt.showAllHint") }}</p>
        </div>
        <Switch :id="switchId" :model-value="world.showAllAlternates" data-testid="show-all" @update:model-value="(on: boolean) => emit('showAll', on)" />
      </div>

      <div class="relative">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" :stroke-width="1.5" />
        <Input v-model="query" class="pl-8" :placeholder="t('alt.search')" :aria-label="t('alt.search')" data-testid="alt-search" />
      </div>
      <p class="text-muted-foreground text-xs tabular-nums" role="status">{{ plural("alt.unlocked", unlockedCount, { total }) }}</p>

      <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2" :class="world.showAllAlternates ? 'opacity-60' : ''">
        <p v-if="!groups.length" class="text-muted-foreground py-6 text-center text-sm">{{ t("alt.none", { query }) }}</p>
        <section v-for="group in groups" :key="group.item" class="py-1.5" data-testid="alt-group">
          <h3 class="text-muted-foreground flex items-center gap-2 py-1 text-xs font-medium">
            <GameIcon :icon="data.items[group.item]?.icon" :size="16" />
            {{ group.itemName }}
          </h3>
          <ul role="list">
            <li v-for="{ recipe, name } in group.recipes" :key="recipe.id">
              <label
                v-tip="() => recipeTooltip(data, recipe.id, language, locale(), t)"
                class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                data-testid="alt-recipe"
              >
                <Checkbox :model-value="unlocked.has(recipe.id)" @update:model-value="(on: boolean | 'indeterminate') => emit('toggle', recipe.id, on === true)" />
                <span class="min-w-0 truncate">{{ name }}</span>
              </label>
            </li>
          </ul>
        </section>
      </div>

      <div class="flex justify-end">
        <Button type="button" data-testid="alt-done" @click="emit('close')">{{ t("alt.done") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
