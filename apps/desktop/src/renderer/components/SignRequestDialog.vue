<script setup lang="ts">
// The pack command asked Tavora to sign with a publisher key it keeps: nothing is signed without this click.
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { act, developerKeys } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const request = computed(() => developerKeys.value?.request ?? null);
const title = computed(() => {
  const asked = request.value;
  if (!asked) return "";
  const params = { name: asked.module?.name ?? t("sign.unknown"), version: asked.module?.version ?? "" };
  return t(asked.kind === "publish" ? "sign.publish.title" : "sign.package.title", params);
});
const text = computed(() => {
  const asked = request.value;
  return asked ? t(asked.kind === "publish" ? "sign.publish.text" : "sign.package.text", { key: asked.fingerprint.slice(0, 16) }) : "";
});

function answer(allow: boolean) {
  const asked = request.value;
  if (asked) void act({ type: "developer-sign-answer", id: asked.id, allow });
}
</script>

<template>
  <ModalDialog v-if="request" :key="request.id" :title="title" :description="text" testid="sign-request" @close="answer(false)">
    <p v-if="request.module" class="text-muted-foreground font-mono text-sm">{{ request.module.id }}</p>
    <p class="text-muted-foreground text-sm">{{ t("sign.hint") }}</p>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" data-testid="sign-refuse" @click="answer(false)">{{ t("sign.refuse") }}</Button>
      <Button data-testid="sign-allow" @click="answer(true)">{{ t("sign.allow") }}</Button>
    </div>
  </ModalDialog>
</template>
