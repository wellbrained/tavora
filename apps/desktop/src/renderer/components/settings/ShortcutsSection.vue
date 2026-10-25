<script setup lang="ts">
// Settings > Shortcuts: every keyboard shortcut, in groups.
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { t } from "../../i18n";
import { MOD, shortcutGroups } from "../../shortcuts";
import SettingGroup from "./SettingGroup.vue";
</script>

<template>
  <p class="text-muted-foreground mb-6 text-sm">{{ t("settings.shortcuts.intro", { mod: MOD() }) }}</p>
  <div data-testid="shortcuts">
    <SettingGroup v-for="group in shortcutGroups()" :key="group.title" :title="group.title">
      <ul>
        <li v-for="row in group.rows" :key="row.action" class="flex min-h-11 items-center gap-6 border-b py-2 last:border-b-0">
          <span class="min-w-0 flex-1">{{ row.action }}</span>
          <span class="flex flex-none items-center gap-1">
            <Kbd v-for="key in row.keys" :key="key">{{ key }}</Kbd>
          </span>
        </li>
      </ul>
    </SettingGroup>
  </div>
</template>
