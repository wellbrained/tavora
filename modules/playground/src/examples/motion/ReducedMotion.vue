<script setup lang="ts">
// Windows' "Show animations" setting arrives as the prefers-reduced-motion media query. The kit follows it by itself.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../../i18n";

const reduced = ref(false);
const media = matchMedia("(prefers-reduced-motion: reduce)");
const follow = () => (reduced.value = media.matches);
onMounted(() => {
  follow();
  media.addEventListener("change", follow);
});
onBeforeUnmount(() => media.removeEventListener("change", follow));
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex items-center gap-2 text-sm">
      {{ t("demo.motion.reducedNow") }}
      <Badge :variant="reduced ? 'info' : 'secondary'" data-testid="reduced-state">{{ reduced ? t("demo.on") : t("demo.off") }}</Badge>
    </p>
    <Notice>{{ t("demo.motion.reducedNote") }}</Notice>
  </div>
</template>
