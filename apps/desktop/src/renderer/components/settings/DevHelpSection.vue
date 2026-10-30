<script setup lang="ts">
// Settings > Examples and help: the examples that ship with Tavora, to open or copy as a new project, and the way to
// the docs and to GitHub.
import { BookOpen, Bug, Copy, FolderOpen, MessageCircleQuestion } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, dialog, state } from "../../host";
import { t } from "../../i18n";
import ModuleRow from "./ModuleRow.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const examples = computed(() => state.value!.modules.filter((module) => module.origin.kind === "example").sort((a, b) => a.name.localeCompare(b.name)));
</script>

<template>
  <SettingGroup v-if="examples.length">
    <SettingRow
      :label="t('settings.development-examples.label')"
      :description="t('settings.development-examples.description')"
      setting="development-examples"
      :highlighted="highlight === 'development-examples'"
    />
    <ul class="flex flex-col" :aria-label="t('settings.development-examples.label')" data-testid="development-examples">
      <ModuleRow v-for="module in examples" :key="module.id" :module="module" hide-origin>
        <Button variant="ghost" :data-testid="`open-example-${module.id}`" @click="act({ type: 'open-example-folder', moduleId: module.id })">
          <FolderOpen :stroke-width="1.5" /> {{ t("common.openFolder") }}
        </Button>
        <Button variant="secondary" :data-testid="`copy-example-${module.id}`" @click="dialog = { kind: 'copy-example', moduleId: module.id }">
          <Copy :stroke-width="1.5" /> {{ t("examples.copy") }}
        </Button>
      </ModuleRow>
    </ul>
  </SettingGroup>

  <SettingGroup>
    <SettingRow
      :label="t('settings.developer-docs.label')"
      :description="t('settings.developer-docs.description')"
      setting="developer-docs"
      :highlighted="highlight === 'developer-docs'"
    >
      <span class="flex flex-none flex-wrap justify-end gap-2">
        <Button variant="secondary" data-testid="developer-link-docs" @click="act({ type: 'open-developer-link', link: 'docs' })">
          <BookOpen :stroke-width="1.5" /> {{ t("settings.devLinks.docs") }}
        </Button>
        <Button variant="secondary" data-testid="developer-link-discussions" @click="act({ type: 'open-developer-link', link: 'discussions' })">
          <MessageCircleQuestion :stroke-width="1.5" /> {{ t("settings.devLinks.discussions") }}
        </Button>
        <Button variant="secondary" data-testid="developer-link-issue" @click="act({ type: 'open-developer-link', link: 'issue' })">
          <Bug :stroke-width="1.5" /> {{ t("settings.devLinks.issue") }}
        </Button>
      </span>
    </SettingRow>
  </SettingGroup>
</template>
