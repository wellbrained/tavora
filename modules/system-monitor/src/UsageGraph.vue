<script setup lang="ts">
// The place for a small usage graph under the CPU and GPU rows. It draws nothing yet: the kit has no chart control,
// and a new one needs the maintainer's OK. The rows already hand it their last 5 minutes (History.values(), oldest
// first, 0 to 100), so a chart only has to be drawn here later. Keep it cheap: no animations, redraw once per snapshot.
import type { History } from "./history";

defineProps<{ history: History }>();
</script>

<template>
  <!-- Intentionally empty: see above. -->
  <span v-if="false" />
</template>
