<script setup lang="ts">
// A setting that holds a list, such as the modules allowed to use a connection or the hotkeys: a SettingRow whose
// whole head opens it in place, so the page stays one short list of rows however much each one holds. The head says
// how much is inside (`description`); the list goes in the default slot, on a quieter background. Buttons for the
// whole setting go in `actions`, beside the head. `details` works as on SettingRow.
import { computed, ref } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { Tooltip } from "@tavora/official-ui/components/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../i18n";
import { isNewSetting } from "./new-settings";
import { useDetails } from "./use-details";

const props = defineProps<{ label: string; description?: string; details?: string; setting?: string; highlighted?: boolean; testid?: string }>();
const open = defineModel<boolean>("open", { default: false });

const isNew = computed(() => isNewSetting(props.setting));
const name = ref<HTMLElement | null>(null);
const tip = useDetails();
</script>

<template>
  <Collapsible
    v-model:open="open"
    :class="cn('-mx-5 border-b transition-colors duration-500 last:border-b-0', highlighted && 'bg-primary/10')"
    :data-setting="setting"
    :data-highlighted="highlighted || undefined"
    :data-testid="testid"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <!-- The chevron the kit puts first goes to the end, where the eye looks for it in a list of rows. -->
      <CollapsibleTrigger
        class="hover:bg-accent/60 min-h-16 min-w-0 flex-1 basis-56 gap-4 rounded-none py-3.5 pr-5 pl-5 text-base font-normal [&>svg:first-child]:order-last"
        :data-testid="testid ? `${testid}-toggle` : undefined"
        @focus="details && name && tip.focus($event, name)"
        @blur="tip.hide()"
      >
        <slot name="lead" />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span
              ref="name"
              :class="cn('font-medium', details && 'decoration-input cursor-help underline decoration-dotted underline-offset-4')"
              @pointerenter="details && tip.show($event.currentTarget as Element)"
              @pointerleave="tip.hide()"
              >{{ label }}</span
            >
            <Badge v-if="isNew" class="py-0 text-[10px] font-semibold uppercase" data-testid="setting-new">{{ t("settings.new") }}</Badge>
            <slot name="badges" />
          </span>
          <span v-if="description || $slots.description" class="text-muted-foreground text-sm"><slot name="description">{{ description }}</slot></span>
          <span v-if="details" class="sr-only">{{ details }}</span>
        </span>
      </CollapsibleTrigger>
      <span v-if="$slots.actions" class="flex flex-none items-center gap-2 pr-5"><slot name="actions" /></span>
    </div>
    <CollapsibleContent class="bg-background/60 border-t px-5 py-2">
      <slot />
    </CollapsibleContent>
    <Tooltip v-if="details" side="right" :open="tip.open.value" :anchor="tip.anchor.value" :description="details" @dismiss="tip.hide()" />
  </Collapsible>
</template>
