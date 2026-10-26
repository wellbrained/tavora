<script setup lang="ts">
// A button that runs an action, stays disabled meanwhile, and shows what went wrong at the top of the page.
// With `ask`, it first asks in a dialog (title plus one sentence) and only runs on the confirm.
import { Button } from "@tavora/official-ui/components/ui/button";
import { ConfirmDialog } from "@tavora/official-ui";
import { ref } from "vue";
import { message } from "../api";
import { problem } from "../problem";

const props = withDefaults(
  defineProps<{
    run: () => Promise<void>;
    variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
    size?: "default" | "sm" | "xs";
    disabled?: boolean;
    ask?: { title: string; description: string; confirm: string };
  }>(),
  { variant: "secondary", size: "sm" },
);

const busy = ref(false);
const asking = ref(false);

async function go(): Promise<void> {
  asking.value = false;
  busy.value = true;
  try {
    await props.run();
    problem.value = "";
  } catch (failure) {
    problem.value = message(failure);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Button type="button" :variant="variant" :size="size" :disabled="busy || disabled" @click="ask ? (asking = true) : go()"><slot /></Button>
  <ConfirmDialog v-if="asking && ask" :title="ask.title" :description="ask.description" :confirm="ask.confirm" @confirm="go" @cancel="asking = false" />
</template>
