<script setup lang="ts">
// The review screen before a dev module goes to the catalog (module-publish.ts): what Tavora packed from
// the project folder, what it asks for, how old the build is and what the catalog lists. What stops it is
// listed with its fix right here: the next version and its patch notes, an id with the developer's own
// prefix (Check, then Claim it), or a build. Publish uploads exactly what this shows; the click is the
// approval, so nothing asks again.
import { CircleAlert, RefreshCw, TriangleAlert } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@tavora/official-ui/components/ui/radio-group";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import type { HostAction, PublishProblem } from "../../../shared/host-api";
import { account, act, dialog, publish, settingsOpen, showToast } from "../../host";
import { formatAgo, t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";

const view = computed(() => publish.value);
const module = computed(() => view.value?.module ?? null);
const busy = ref(false);

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}

const problem = <K extends PublishProblem["kind"]>(kind: K) => view.value?.problems.find((item): item is Extract<PublishProblem, { kind: K }> => item.kind === kind) ?? null;
const versionProblem = computed(() => problem("version"));
const prefixProblem = computed(() => problem("prefix"));
const notBuilt = computed(() => problem("not-built"));
const invalid = computed(() => problem("invalid"));

const title = computed(() => (view.value?.status === "published" ? t("publish.done", { version: view.value.published?.version ?? "" }) : t("publish.title", { name: module.value?.name ?? "" })));
const catalogLine = computed(() => {
  const catalog = view.value?.catalog;
  if (!catalog) return "";
  if (catalog.kind === "first") return t("publish.first");
  if (catalog.kind === "update") return t("publish.update", { version: catalog.version });
  return t("publish.catalogUnknown");
});
const asks = computed(() => {
  const list = [...(view.value?.asks.network ?? []), ...(view.value?.asks.connectors ?? []).map((id) => t(`catalog.accessConnector.${id}`))];
  return list.length ? t("publish.asks", { list: list.join(", ") }) : t("publish.asksNothing");
});
const size = computed(() => {
  const bytes = view.value?.size;
  if (bytes == null) return null;
  return bytes < 1024 * 1024 ? t("catalog.sizeKb", { size: Math.max(1, Math.round(bytes / 1024)) }) : t("catalog.sizeMb", { size: (bytes / 1024 / 1024).toFixed(1) });
});

// The version and its patch notes: the next versions when the catalog has this one, or notes for this one.
const version = ref("");
const notesText = ref("");
const writingNotes = ref(false);
watch(
  versionProblem,
  (found) => {
    version.value = found?.next.patch ?? "";
  },
  { immediate: true },
);
const notes = computed(() =>
  notesText.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);
async function saveVersion() {
  const next = versionProblem.value ? version.value : module.value?.version;
  if (!next || !notes.value.length) return;
  if (await run({ type: "publish-write", version: next, notes: notes.value })) {
    notesText.value = "";
    writingNotes.value = false;
  }
}

// A new id, with the developer's own prefix: Check, then Claim it (or Use it, for a prefix held already).
const newId = ref("");
watch(
  () => [prefixProblem.value?.prefix, module.value?.id, view.value?.ownPrefix] as const,
  ([bad, id, own]) => {
    if (bad && id) newId.value = `${own ?? bad}.${id.split(".").slice(1).join(".")}`;
  },
  { immediate: true },
);
const idPrefix = computed(() => newId.value.trim().split(".")[0] ?? "");
const idState = computed(() => {
  const checked = account.value?.prefixCheck;
  return checked && checked.prefix === idPrefix.value && idPrefix.value !== prefixProblem.value?.prefix ? checked.state : null;
});
async function pressId() {
  const id = newId.value.trim();
  if (!id) return;
  if (idState.value === "free") {
    if (await run({ type: "account-prefix-claim", prefix: idPrefix.value })) await run({ type: "publish-set-id", id });
  } else if (idState.value === "held") {
    await run({ type: "publish-set-id", id });
  } else {
    await run({ type: "account-prefix-check", prefix: idPrefix.value });
  }
}
const idButton = computed(() => (idState.value === "free" ? t("prefix.claim") : idState.value === "held" ? t("publish.useId") : idState.value === null ? t("prefix.check") : t("prefix.checkAgain")));

async function claimNew() {
  const prefix = view.value?.newPrefix?.prefix;
  if (prefix && (await run({ type: "account-prefix-claim", prefix }))) {
    showToast(t("prefix.claimed", { prefix }));
    await run({ type: "publish-refresh" });
  }
}

function close() {
  if (view.value?.status !== "publishing") void act({ type: "publish-close" });
}

function browse() {
  const id = view.value?.published?.id;
  void act({ type: "publish-close" });
  if (!id) return;
  settingsOpen.value = false;
  dialog.value = { kind: "add-module", browse: id };
}
</script>

<template>
  <ModalDialog v-if="view" :title="title" class="sm:max-w-[560px]" testid="publish-review" @close="close">
    <!-- Published. -->
    <template v-if="view.status === 'published'">
      <p class="text-muted-foreground text-sm" data-testid="publish-done">{{ t("publish.doneText") }}</p>
      <div class="flex justify-end gap-2">
        <Button variant="ghost" @click="close">{{ t("common.close") }}</Button>
        <Button data-testid="publish-browse" @click="browse">{{ t("publish.browse") }}</Button>
      </div>
    </template>

    <template v-else>
      <div v-if="module" class="flex items-start gap-3">
        <span class="bg-primary/10 border-primary/20 flex size-10 flex-none items-center justify-center overflow-hidden rounded-lg border" aria-hidden="true">
          <img v-if="module.icon" :src="module.icon" alt="" class="size-6" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex items-center gap-2">
            <span class="truncate font-medium">{{ module.name }}</span>
            <span class="text-muted-foreground text-xs tabular-nums" data-testid="publish-version">{{ module.version }}</span>
          </span>
          <span class="text-muted-foreground truncate font-mono text-xs" data-testid="publish-id">{{ module.id }}</span>
          <span v-if="view.status !== 'checking'" class="text-muted-foreground text-sm" data-testid="publish-catalog">{{ catalogLine }}</span>
        </div>
      </div>

      <p v-if="view.status === 'checking'" class="text-muted-foreground text-sm" role="status" data-testid="publish-checking">{{ t("publish.checking") }}</p>

      <template v-else>
        <ul v-if="module" class="text-muted-foreground flex flex-col gap-1 text-sm">
          <li data-testid="publish-asks">{{ asks }}</li>
          <li v-if="size || view.builtAt" data-testid="publish-build">
            <template v-if="size">{{ size }}</template><template v-if="size && view.builtAt"> · </template><template v-if="view.builtAt">{{ t("publish.built", { time: formatAgo(view.builtAt) }) }}</template>
          </li>
          <li v-if="view.sourceNewer" class="text-foreground flex gap-2" data-testid="publish-source-newer">
            <TriangleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ t("publish.sourceNewer") }}
          </li>
        </ul>

        <!-- This version's patch notes, unless picking the next version, which writes its own. -->
        <div v-if="module && !versionProblem" class="flex flex-col gap-1" data-testid="publish-notes">
          <span class="text-sm font-medium">{{ t("publish.notes") }}</span>
          <ul v-if="view.notes.length" class="text-muted-foreground list-disc pl-5 text-sm">
            <li v-for="(line, index) in view.notes" :key="index">{{ line }}</li>
          </ul>
          <template v-else-if="!writingNotes">
            <span class="text-muted-foreground text-sm">{{ t("publish.noNotes", { version: module.version }) }}</span>
            <div>
              <Button variant="ghost" size="sm" data-testid="publish-add-notes" @click="writingNotes = true">{{ t("publish.addNotes") }}</Button>
            </div>
          </template>
          <form v-if="writingNotes" class="flex flex-col gap-2" @submit.prevent="saveVersion">
            <Textarea v-model="notesText" rows="3" :aria-label="t('publish.notesLabel', { version: module.version })" :placeholder="t('publish.notesPlaceholder')" data-testid="publish-notes-input" />
            <div class="flex items-center gap-2">
              <Button type="submit" variant="secondary" size="sm" :disabled="busy || !notes.length" data-testid="publish-notes-save">{{ t("publish.save") }}</Button>
              <span class="text-muted-foreground text-xs">{{ t("publish.saveHint") }}</span>
            </div>
          </form>
        </div>

        <!-- What stops it, each with its fix. -->
        <section v-if="versionProblem" class="flex flex-col gap-3 rounded-lg border p-3" data-testid="publish-problem-version">
          <p class="flex gap-2 text-sm"><CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ t("publish.versionTaken", { version: versionProblem.listed }) }}</p>
          <RadioGroup v-model="version" class="gap-2 pl-6">
            <Label v-for="kind in ['patch', 'minor', 'major'] as const" :key="kind" class="font-normal">
              <RadioGroupItem :value="versionProblem.next[kind]" :data-testid="`publish-next-${kind}`" />
              {{ t(`publish.version.${kind}`, { version: versionProblem.next[kind] }) }}
            </Label>
          </RadioGroup>
          <form class="flex flex-col gap-2 pl-6" @submit.prevent="saveVersion">
            <Textarea v-model="notesText" rows="3" :aria-label="t('publish.notesLabel', { version })" :placeholder="t('publish.notesPlaceholder')" data-testid="publish-notes-input" />
            <div class="flex items-center gap-2">
              <Button type="submit" variant="secondary" size="sm" :disabled="busy || !notes.length || !version" data-testid="publish-version-save">{{ t("publish.save") }}</Button>
              <span class="text-muted-foreground text-xs">{{ t("publish.saveHint") }}</span>
            </div>
          </form>
        </section>

        <section v-if="prefixProblem" class="flex flex-col gap-2 rounded-lg border p-3" data-testid="publish-problem-prefix">
          <p class="flex gap-2 text-sm">
            <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ t(`prefix.state.${prefixProblem.state}`, { prefix: prefixProblem.prefix }) }}
          </p>
          <form class="flex flex-col gap-1 pl-6" @submit.prevent="pressId">
            <label class="text-muted-foreground text-sm" for="publish-new-id">{{ t("publish.prefixProblem") }}</label>
            <div class="flex gap-2">
              <Input id="publish-new-id" v-model="newId" class="font-mono" maxlength="128" autocomplete="off" spellcheck="false" data-testid="publish-id-input" />
              <Button type="submit" :variant="idState === 'free' || idState === 'held' ? 'default' : 'secondary'" :disabled="busy || !newId.trim()" data-testid="publish-id-button">{{ idButton }}</Button>
            </div>
            <span v-if="idState" class="text-muted-foreground text-sm" role="status" data-testid="publish-id-state">{{ t(`prefix.state.${idState}`, { prefix: idPrefix }) }}</span>
          </form>
        </section>

        <p v-if="notBuilt" class="flex gap-2 rounded-lg border p-3 text-sm" data-testid="publish-problem-not-built">
          <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ t("publish.notBuilt") }}
        </p>
        <p v-if="invalid" class="flex gap-2 rounded-lg border p-3 text-sm" data-testid="publish-problem-invalid">
          <CircleAlert class="text-warning mt-0.5 size-4 flex-none" :stroke-width="1.5" /> {{ invalid.message }}
        </p>

        <div v-if="view.newPrefix && !view.problems.length" class="flex flex-wrap items-center gap-2 text-sm" data-testid="publish-new-prefix">
          <span class="text-muted-foreground">{{ t("publish.newPrefix", { prefix: view.newPrefix.prefix, max: view.newPrefix.max }) }}</span>
          <Button variant="ghost" size="sm" :disabled="busy" data-testid="publish-claim-prefix" @click="claimNew">{{ t("prefix.claim") }}</Button>
        </div>

        <p v-if="view.error" class="text-destructive text-sm" role="alert" data-testid="publish-error">{{ view.error }}</p>
      </template>

      <div class="flex items-center justify-end gap-2">
        <Button variant="ghost" size="icon-sm" class="mr-auto" :disabled="busy || view.status !== 'ready'" :aria-label="t('publish.checkAgain')" :title="t('publish.checkAgain')" data-testid="publish-refresh" @click="run({ type: 'publish-refresh' })">
          <RefreshCw :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" :disabled="view.status === 'publishing'" data-testid="publish-cancel" @click="close">{{ t("common.cancel") }}</Button>
        <Button :disabled="busy || view.status !== 'ready' || view.problems.length > 0" data-testid="publish-upload" @click="run({ type: 'publish-upload' })">
          {{ view.status === "publishing" ? t("publish.publishing") : t("publish.publish") }}
        </Button>
      </div>
    </template>
  </ModalDialog>
</template>
