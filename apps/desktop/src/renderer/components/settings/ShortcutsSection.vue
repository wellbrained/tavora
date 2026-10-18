<script setup lang="ts">
// Settings > Shortcuts: every keyboard shortcut, in groups.
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
            <kbd v-for="key in row.keys" :key="key" class="bg-secondary text-foreground min-w-7 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs">{{ key }}</kbd>
          </span>
        </li>
      </ul>
    </SettingGroup>
  </div>
</template>
