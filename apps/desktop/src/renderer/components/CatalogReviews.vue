<script setup lang="ts">
// The Ratings and reviews section of a catalog module's page (decided 2026-10-21). It shows the
// summary with its 5 to 1 star bars, the user's own rating, and the newest reviews with the
// publisher's one reply. Rating needs a sign-in and the module installed, and never your own module;
// the main process checks the rest and sends the installed version along. Every text is plain text,
// and a reviewer's picture is a PNG the main process checked by its hash. Report sends only the review's id.
import { computed, onMounted, ref } from "vue";
import type { CatalogReviewsResult, CatalogReviewView } from "../../shared/host-api";
import { act, api, dialog, openProfile } from "../host";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { StarRating } from "@tavora/official-ui/components/ui/star-rating";
import { Textarea } from "@tavora/official-ui/components/ui/textarea";
import { formatDate, formatNumber, t } from "../i18n";
import ProfileAvatar from "./profile/ProfileAvatar.vue";

const props = defineProps<{ moduleId: string; moduleName: string; publisher: string | null }>();

const MAX_TEXT = 500;
const result = ref<CatalogReviewsResult | null>(null);
const stars = ref(0);
const text = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
/** The review whose reply is being written, its draft, and the review whose Report waits for a yes. */
const replying = ref<string | null>(null);
const replyText = ref("");
const reportAsk = ref<string | null>(null);
const reported = ref<Set<string>>(new Set());
const reviewErrors = ref<Record<string, string>>({});

const loaded = computed(() => (result.value?.status === "ok" ? result.value : null));
const mine = computed(() => loaded.value?.mine ?? null);
const length = computed(() => [...text.value.trim()].length);
const changed = computed(() => stars.value > 0 && (stars.value !== mine.value?.stars || (text.value.trim() || null) !== (mine.value?.text ?? null)));
/** Rated on an older version than the one installed: asked once if it still holds. */
const older = computed(() => (mine.value && loaded.value?.installedVersion && mine.value.version !== loaded.value.installedVersion ? mine.value.version : null));
const average = computed(() => (loaded.value?.rating ? formatNumber(loaded.value.rating.average) : ""));
const rows = computed(() => {
  const rating = loaded.value?.rating;
  return rating ? [5, 4, 3, 2, 1].map((n) => ({ stars: n, percent: Math.round(((rating.stars[n - 1] ?? 0) / rating.count) * 100) })) : [];
});

async function load() {
  result.value = await api.catalogReviews(props.moduleId);
  stars.value = mine.value?.stars ?? 0;
  text.value = mine.value?.text ?? "";
}
onMounted(load);
async function retry() {
  result.value = null;
  await load();
}

async function run(action: Parameters<typeof act>[0], onError: (message: string) => void = (message) => (error.value = message)) {
  busy.value = true;
  error.value = null;
  const outcome = await act(action, { quiet: true });
  busy.value = false;
  if (!outcome.ok) {
    onError(outcome.error);
    return false;
  }
  return true;
}

async function post() {
  if (await run({ type: "rate-catalog-module", moduleId: props.moduleId, stars: stars.value, text: text.value.trim() || null })) await load();
}

/** Keeps the rating as it is, given on the installed version now. */
async function keep() {
  const own = mine.value;
  if (own && (await run({ type: "rate-catalog-module", moduleId: props.moduleId, stars: own.stars, text: own.hidden ? null : own.text }))) await load();
}

async function remove() {
  if (await run({ type: "unrate-catalog-module", moduleId: props.moduleId })) await load();
}

function startReply(review: CatalogReviewView) {
  replying.value = review.id;
  replyText.value = review.reply?.text ?? "";
}

async function sendReply(review: CatalogReviewView, value: string | null) {
  const fail = (message: string) => (reviewErrors.value = { ...reviewErrors.value, [review.id]: message });
  if (await run({ type: "reply-catalog-review", moduleId: props.moduleId, reviewId: review.id, text: value }, fail)) {
    replying.value = null;
    await load();
  }
}

async function report(review: CatalogReviewView) {
  const fail = (message: string) => (reviewErrors.value = { ...reviewErrors.value, [review.id]: message });
  if (await run({ type: "report-catalog-review", reviewId: review.id }, fail)) reported.value = new Set([...reported.value, review.id]);
  reportAsk.value = null;
}

function signIn() {
  dialog.value = null;
  openProfile("account");
}

const nameOf = (review: CatalogReviewView) => review.author.name ?? t("catalog.reviews.anonymous");
const dateOf = (value: string) => (value && !Number.isNaN(Date.parse(value)) ? formatDate(value) : "");
</script>

<template>
  <section data-testid="catalog-reviews" :aria-label="t('catalog.reviews.title')">
    <h3 class="mb-3 font-medium">{{ t("catalog.reviews.title") }}</h3>
    <p v-if="!result" class="text-muted-foreground text-sm" role="status">{{ t("catalog.reviews.loading") }}</p>
    <div v-else-if="!loaded" class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status" data-testid="catalog-reviews-missing">
      <p>{{ result.status === "off" ? t("catalog.status.off") : t("catalog.reviews.missing") }}</p>
      <Button v-if="result.status !== 'off'" size="sm" variant="secondary" data-testid="catalog-reviews-retry" @click="retry">{{ t("catalog.retry") }}</Button>
    </div>
    <template v-else>
      <div v-if="loaded.rating" class="mb-5 grid items-center gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]" data-testid="catalog-reviews-summary">
        <div class="flex flex-col items-start gap-1">
          <span class="text-3xl font-semibold tabular-nums">{{ average }}</span>
          <StarRating :model-value="loaded.rating.average" :label="t('catalog.rating.label', { average })" />
          <span class="text-muted-foreground text-xs">{{ t("catalog.rating.count", { count: loaded.rating.count }) }}</span>
        </div>
        <ul class="max-w-80 space-y-1.5">
          <li v-for="row in rows" :key="row.stars" class="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
            <span class="text-muted-foreground">{{ t("catalog.rating.stars", { count: row.stars }) }}</span>
            <Progress :model-value="row.percent" :aria-label="t('catalog.rating.stars', { count: row.stars })" />
            <span class="text-muted-foreground text-right tabular-nums">{{ t("catalog.rating.percent", { percent: row.percent }) }}</span>
          </li>
        </ul>
      </div>

      <div class="bg-muted/30 mb-5 rounded-lg border p-4" data-testid="catalog-reviews-mine">
        <template v-if="loaded.can === 'rate'">
          <div class="mb-2 flex items-center gap-3">
            <span class="text-sm font-medium">{{ t("catalog.reviews.yours") }}</span>
            <StarRating v-model="stars" editable size="lg" :label="t('catalog.reviews.yours')" :star-label="(n) => t('catalog.rating.stars', { count: n })" :disabled="busy" data-testid="catalog-reviews-stars" />
          </div>
          <p v-if="older" class="mb-2 flex flex-wrap items-center gap-2 text-sm" data-testid="catalog-reviews-older">
            {{ t("catalog.reviews.older", { version: older }) }}
            <Button size="sm" variant="secondary" :disabled="busy" data-testid="catalog-reviews-keep" @click="keep">{{ t("catalog.reviews.keep") }}</Button>
          </p>
          <p v-if="mine?.hidden" class="text-muted-foreground mb-2 text-sm" role="status">{{ t("catalog.reviews.hidden") }}</p>
          <p v-else-if="mine?.held" class="text-muted-foreground mb-2 text-sm" role="status" data-testid="catalog-reviews-held">{{ t("catalog.reviews.held") }}</p>
          <Textarea v-model="text" :placeholder="t('catalog.reviews.placeholder')" :aria-label="t('catalog.reviews.placeholder')" class="min-h-20 text-sm" :disabled="busy" data-testid="catalog-reviews-text" />
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-muted-foreground min-w-0 flex-1 text-xs">{{ t("catalog.reviews.public") }}</span>
            <span class="text-xs tabular-nums" :class="length > MAX_TEXT ? 'text-destructive' : 'text-muted-foreground'">{{ t("catalog.reviews.length", { count: length }) }}</span>
            <Button v-if="mine" size="sm" variant="ghost" :disabled="busy" data-testid="catalog-reviews-delete" @click="remove">{{ t("catalog.reviews.delete") }}</Button>
            <Button size="sm" :disabled="busy || !changed || length > MAX_TEXT" data-testid="catalog-reviews-post" @click="post">
              {{ busy ? t("catalog.reviews.posting") : mine ? t("catalog.reviews.update") : t("catalog.reviews.post") }}
            </Button>
          </div>
        </template>
        <p v-else-if="loaded.can === 'sign-in'" class="flex flex-wrap items-center gap-3 text-sm">
          {{ t("catalog.reviews.signIn") }}
          <Button size="sm" variant="secondary" data-testid="catalog-reviews-sign-in" @click="signIn">{{ t("catalog.reviews.signInButton") }}</Button>
        </p>
        <p v-else class="text-sm">{{ t("catalog.reviews.own") }}</p>
        <p v-if="error" class="text-destructive mt-2 text-sm" role="alert" data-testid="catalog-reviews-error">{{ error }}</p>
      </div>

      <p v-if="!loaded.reviews.length" class="text-muted-foreground text-sm" data-testid="catalog-reviews-none">{{ t("catalog.reviews.none") }}</p>
      <ul v-else class="divide-y" data-testid="catalog-reviews-list">
        <li v-for="review in loaded.reviews" :key="review.id" class="py-4 first:pt-0" :data-testid="`catalog-review-${review.id}`">
          <div class="flex items-center gap-2">
            <ProfileAvatar :name="review.author.name ?? ''" :initials="review.author.initials ?? ''" :picture-url="review.author.picture" :size="28" />
            <span class="min-w-0 truncate text-sm font-medium">{{ nameOf(review) }}</span>
            <span class="text-muted-foreground ml-auto flex-none text-xs">{{ t("catalog.reviews.version", { version: review.version }) }}<template v-if="dateOf(review.date)"> · {{ dateOf(review.date) }}</template></span>
          </div>
          <StarRating :model-value="review.stars" size="sm" class="mt-1.5" :label="t('catalog.rating.stars', { count: review.stars })" />
          <p class="mt-1 text-sm break-words whitespace-pre-line">{{ review.text }}</p>

          <div v-if="review.reply && replying !== review.id" class="border-primary/40 bg-muted/30 mt-3 rounded-md border-l-2 px-3 py-2" data-testid="catalog-review-reply">
            <p class="text-muted-foreground text-xs">{{ publisher ? t("catalog.reviews.replyFrom", { name: publisher }) : t("catalog.reviews.replyFromDeveloper") }}<template v-if="dateOf(review.reply.date)"> · {{ dateOf(review.reply.date) }}</template></p>
            <p class="mt-1 text-sm break-words whitespace-pre-line">{{ review.reply.text }}</p>
          </div>
          <div v-if="replying === review.id" class="mt-3 space-y-2">
            <Textarea v-model="replyText" :placeholder="t('catalog.reviews.replyPlaceholder')" :aria-label="t('catalog.reviews.replyPlaceholder')" class="min-h-16 text-sm" :disabled="busy" data-testid="catalog-review-reply-text" />
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground flex-1 text-xs tabular-nums">{{ t("catalog.reviews.length", { count: [...replyText.trim()].length }) }}</span>
              <Button size="sm" variant="ghost" :disabled="busy" @click="replying = null">{{ t("common.cancel") }}</Button>
              <Button size="sm" :disabled="busy || !replyText.trim() || [...replyText.trim()].length > MAX_TEXT" data-testid="catalog-review-reply-send" @click="sendReply(review, replyText)">{{ t("catalog.reviews.reply") }}</Button>
            </div>
          </div>

          <p v-if="reviewErrors[review.id]" class="text-destructive mt-2 text-sm" role="alert">{{ reviewErrors[review.id] }}</p>
          <p v-if="reported.has(review.id)" class="text-muted-foreground mt-2 text-sm" role="status">{{ t("catalog.reviews.reported") }}</p>
          <div v-else-if="reportAsk === review.id" class="bg-muted/40 mt-2 flex flex-wrap items-center gap-2 rounded-md p-3">
            <p class="w-full text-sm">{{ t("catalog.reviews.reportAsk") }}</p>
            <Button size="sm" variant="secondary" :disabled="busy" :data-testid="`catalog-review-report-send-${review.id}`" @click="report(review)">{{ t("catalog.reviews.reportSend") }}</Button>
            <Button size="sm" variant="ghost" :disabled="busy" @click="reportAsk = null">{{ t("common.cancel") }}</Button>
          </div>
          <div v-else-if="replying !== review.id" class="mt-2 flex gap-1">
            <template v-if="loaded.can === 'own'">
              <Button size="sm" variant="ghost" class="text-muted-foreground" :disabled="busy" data-testid="catalog-review-reply-start" @click="startReply(review)">
                {{ review.reply ? t("catalog.reviews.replyEdit") : t("catalog.reviews.reply") }}
              </Button>
              <Button v-if="review.reply" size="sm" variant="ghost" class="text-muted-foreground" :disabled="busy" @click="sendReply(review, null)">{{ t("catalog.reviews.replyDelete") }}</Button>
            </template>
            <Button size="sm" variant="ghost" class="text-muted-foreground" :aria-label="t('catalog.reviews.reportLabel', { name: nameOf(review) })" :data-testid="`catalog-review-report-${review.id}`" @click="reportAsk = review.id">
              {{ t("catalog.reviews.report") }}
            </Button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
