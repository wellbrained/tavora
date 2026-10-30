<script setup lang="ts">
// One open PDF: a toolbar, a contents list on the side when the PDF has one, and the pages in one long scroll.
// It remembers the page and zoom per file (the parent saves what it reports) and searches the whole text.
import { ChevronDown, ChevronUp, Columns2, Expand, ListTree, Minus, Plus, Search, X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import OutlineList from "./OutlineList.vue";
import PdfPage from "./PdfPage.vue";
import { clampZoom, type FileView, type FitMode } from "./files";
import { t } from "./i18n";
import { fitZoom, layoutPages, pageAtOffset, pagesInBand, PAGE_GAP, parsePageInput, stepZoom, type PageSize } from "./layout";
import { closePdf, loadOutline, openPdf, PdfProblem, type OutlineNode, type PDFDocumentProxy } from "./pdf";
import { buildPageText, findMatches, firstMatchFrom, stepMatch, type Match, type PageText, type Range } from "./search";

const props = defineProps<{ url: string; view: FileView }>();
const emit = defineEmits<{ view: [view: Partial<FileView>] }>();

type Status = "opening" | "ready" | "gone" | "password" | "broken";

const status = ref<Status>("opening");
const pdf = shallowRef<PDFDocumentProxy | null>(null);
const sizes = ref<PageSize[]>([]);
const outline = ref<OutlineNode[]>([]);
const outlineOpen = ref(false);
const zoom = ref(clampZoom(props.view.zoom));
const fit = ref<FitMode>(props.view.fit);
const page = ref(1);
const pageField = ref("1");
const scroller = ref<HTMLElement | null>(null);
const viewport = reactive({ top: 0, height: 0, width: 0 });
const pageRefs = new Map<number, InstanceType<typeof PdfPage>>();

let loadToken = 0;
let restoring = true;

const count = computed(() => sizes.value.length);
const layout = computed(() => layoutPages(sizes.value, zoom.value));
const columnWidth = computed(() => Math.max(0, ...sizes.value.map((size) => size.width)) * zoom.value + PAGE_GAP * 2);
const near = computed(() => new Set(pagesInBand(layout.value.tops, sizes.value, zoom.value, viewport.top - viewport.height, viewport.top + viewport.height * 2)));

// ── Opening

async function load() {
  const mine = ++loadToken;
  status.value = "opening";
  restoring = true;
  void closePdf(pdf.value);
  pdf.value = null;
  try {
    const opened = await openPdf(props.url);
    if (mine !== loadToken) return void closePdf(opened);
    const found: PageSize[] = [];
    for (let start = 1; start <= opened.numPages; start += 40) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(40, opened.numPages - start + 1) }, async (_, offset) => {
          const { width, height } = (await opened.getPage(start + offset)).getViewport({ scale: 1 });
          return { width, height };
        }),
      );
      found.push(...batch);
      if (mine !== loadToken) return void closePdf(opened);
    }
    sizes.value = found;
    pdf.value = opened;
    outline.value = await loadOutline(opened);
    if (mine !== loadToken) return;
    status.value = "ready";
    await nextTick();
    measure();
    const wanted = Math.min(Math.max(1, props.view.page), Math.max(1, found.length));
    if (fit.value) refit();
    await nextTick();
    goToPage(wanted, false);
    // What the scroll reports while the page is being put in place is not the reader's doing.
    setTimeout(() => (restoring = false), 150);
  } catch (error) {
    if (mine !== loadToken) return;
    status.value = error instanceof PdfProblem ? error.kind : "broken";
  }
}

onMounted(() => {
  void load();
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  loadToken++;
  window.removeEventListener("keydown", onKey);
  resizer?.disconnect();
  void closePdf(pdf.value);
});

let resizer: ResizeObserver | null = null;
watch(scroller, (element) => {
  resizer?.disconnect();
  if (!element) return;
  resizer = new ResizeObserver(() => {
    measure();
    if (fit.value) refit();
  });
  resizer.observe(element);
});

// ── Scrolling and the page the reader is on

function measure() {
  const element = scroller.value;
  if (!element) return;
  viewport.top = element.scrollTop;
  viewport.height = element.clientHeight;
  viewport.width = element.clientWidth;
}

function onScroll() {
  measure();
  const now = pageAtOffset(layout.value.tops, viewport.top + PAGE_GAP + 1);
  if (now === page.value) return;
  page.value = now;
  if (!restoring) emit("view", { page: now });
}

watch(page, (now) => (pageField.value = String(now)));

function goToPage(target: number, remember = true) {
  const element = scroller.value;
  if (!element || count.value === 0) return;
  const number = Math.min(count.value, Math.max(1, target));
  element.scrollTop = Math.max(0, layout.value.tops[number - 1]! - PAGE_GAP);
  measure();
  page.value = number;
  pageField.value = String(number);
  if (remember && !restoring) emit("view", { page: number });
}

function submitPage() {
  const target = parsePageInput(pageField.value, count.value);
  if (target === null) pageField.value = String(page.value);
  else goToPage(target);
}

// ── Zoom and fit

/** Changes the zoom and keeps the reader at the same place in the same page. */
async function setZoom(next: number, mode: FitMode) {
  const element = scroller.value;
  const value = clampZoom(next);
  fit.value = mode;
  if (!element || value === zoom.value) {
    emit("view", { zoom: value, fit: mode });
    return;
  }
  const anchor = page.value;
  const size = sizes.value[anchor - 1];
  const inside = size ? (element.scrollTop - layout.value.tops[anchor - 1]!) / (size.height * zoom.value) : 0;
  zoom.value = value;
  await nextTick();
  if (size) element.scrollTop = layout.value.tops[anchor - 1]! + inside * size.height * value;
  measure();
  emit("view", { zoom: value, fit: mode });
}

/** Works out the fit again (the panel changed size, or the page did). */
function refit() {
  const mode = fit.value;
  const size = sizes.value[page.value - 1];
  const element = scroller.value;
  if (!mode || !size || !element) return;
  const next = fitZoom(mode, size, { width: element.clientWidth, height: element.clientHeight });
  if (Math.abs(next - zoom.value) > 0.001) void setZoom(next, mode);
}

function fitTo(mode: "width" | "page") {
  const size = sizes.value[page.value - 1];
  const element = scroller.value;
  if (!size || !element) return;
  void setZoom(fitZoom(mode, size, { width: element.clientWidth, height: element.clientHeight }), mode);
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey) return;
  event.preventDefault();
  void setZoom(zoom.value * Math.exp(-event.deltaY * 0.002), null);
}

// ── Search

const searching = ref(false);
const query = ref("");
const busy = ref(false);
const matches = ref<Match[]>([]);
const current = ref(-1);
let texts: PageText[] | null = null;
let searchToken = 0;
let typing: ReturnType<typeof setTimeout> | undefined;

async function allTexts(document: PDFDocumentProxy, mine: number): Promise<PageText[] | null> {
  if (texts) return texts;
  const found: PageText[] = [];
  for (let start = 1; start <= document.numPages; start += 20) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(20, document.numPages - start + 1) }, async (_, offset) => {
        const content = await (await document.getPage(start + offset)).getTextContent();
        return buildPageText(content.items.filter((item): item is Extract<typeof item, { str: string }> => "str" in item));
      }),
    );
    found.push(...batch);
    if (mine !== searchToken) return null;
  }
  texts = found;
  return found;
}

async function runSearch() {
  const document = pdf.value;
  const mine = ++searchToken;
  if (!document || !query.value.trim()) {
    matches.value = [];
    current.value = -1;
    busy.value = false;
    return;
  }
  busy.value = true;
  try {
    const loaded = await allTexts(document, mine);
    if (!loaded || mine !== searchToken) return;
    matches.value = findMatches(loaded.map((entry) => entry.text), query.value);
    current.value = firstMatchFrom(matches.value, page.value);
  } finally {
    if (mine === searchToken) busy.value = false;
  }
  void showCurrent();
}

watch(query, () => {
  clearTimeout(typing);
  typing = setTimeout(() => void runSearch(), 250);
});

function step(direction: 1 | -1) {
  current.value = stepMatch(current.value, matches.value.length, direction);
  void showCurrent();
}

/** Scrolls to the match the reader is on: first its page, then the exact spot once that page has drawn its text. */
async function showCurrent() {
  const match = matches.value[current.value];
  if (!match) return;
  const element = scroller.value;
  if (!element) return;
  const mine = searchToken;
  const mark = () => pageRefs.get(match.page)?.markTop() ?? null;
  if (mark() === null) goToPage(match.page);
  for (let tries = 0; tries < 20; tries++) {
    const top = mark();
    if (top !== null) {
      const box = element.getBoundingClientRect();
      const inView = top >= box.top + 40 && top <= box.bottom - 40;
      if (!inView) element.scrollTop += top - box.top - box.height / 3;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    if (mine !== searchToken || matches.value[current.value] !== match) return;
  }
}

const rangesByPage = computed(() => {
  const map = new Map<number, Range[]>();
  for (const match of matches.value) {
    const list = map.get(match.page);
    if (list) list.push(match);
    else map.set(match.page, [match]);
  }
  return map;
});
const currentMatch = computed(() => matches.value[current.value] ?? null);
const noRanges: Range[] = [];

const searchSummary = computed(() => {
  if (busy.value) return t("pdf.searching");
  if (!query.value.trim()) return "";
  if (texts && texts.every((entry) => entry.text.trim() === "")) return t("pdf.noText");
  return matches.value.length ? t("pdf.matches", { current: current.value + 1, count: matches.value.length }) : t("pdf.noMatches");
});

async function openSearch() {
  searching.value = true;
  await nextTick();
  const input = document.querySelector<HTMLInputElement>("[data-testid='pdf-search-input']");
  input?.focus();
  input?.select();
}

function closeSearch() {
  searching.value = false;
  searchToken++;
  query.value = "";
  matches.value = [];
  current.value = -1;
  busy.value = false;
}

function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    void openSearch();
  } else if (event.key === "Escape" && searching.value) {
    closeSearch();
  }
}

const percent = computed(() => Math.round(zoom.value * 100));
const setPageRef = (number: number) => (element: unknown) => {
  if (element) pageRefs.set(number, element as InstanceType<typeof PdfPage>);
  else pageRefs.delete(number);
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="pdf-pane">
    <Notice v-if="status === 'gone' || status === 'password' || status === 'broken'" variant="error" class="m-3" data-testid="pdf-error">
      {{ status === "gone" ? t("pdf.fileGone") : status === "password" ? t("pdf.password") : t("pdf.failed") }}
      <template v-if="status === 'broken'" #action>
        <Button size="sm" variant="secondary" @click="load">{{ t("pdf.retry") }}</Button>
      </template>
    </Notice>
    <p v-else-if="status === 'opening'" class="text-muted-foreground p-4 text-sm" data-testid="pdf-opening">{{ t("pdf.opening") }}</p>

    <template v-else>
      <div class="bg-card flex flex-wrap items-center gap-1 border-b px-2 py-1" role="toolbar" :aria-label="t('pdf.toolbar')">
        <Button v-if="outline.length" variant="ghost" size="icon-sm" :aria-pressed="outlineOpen" :title="t('pdf.outline')" :aria-label="t('pdf.outline')" data-testid="pdf-outline-toggle" @click="outlineOpen = !outlineOpen">
          <ListTree :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :disabled="page <= 1" :title="t('pdf.previous')" :aria-label="t('pdf.previous')" data-testid="pdf-prev" @click="goToPage(page - 1)">
          <ChevronUp :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :disabled="page >= count" :title="t('pdf.next')" :aria-label="t('pdf.next')" data-testid="pdf-next" @click="goToPage(page + 1)">
          <ChevronDown :stroke-width="1.5" />
        </Button>
        <form class="flex items-center gap-1.5" @submit.prevent="submitPage">
          <Input v-model="pageField" inputmode="numeric" class="h-7 w-12 px-1 text-center text-sm" :aria-label="t('pdf.page')" data-testid="pdf-page-input" @blur="submitPage" />
          <span class="text-muted-foreground text-sm whitespace-nowrap">{{ t("pdf.of", { count }) }}</span>
        </form>
        <span class="bg-border mx-1 h-4 w-px" aria-hidden="true" />
        <Button variant="ghost" size="icon-sm" :title="t('pdf.zoomOut')" :aria-label="t('pdf.zoomOut')" data-testid="pdf-zoom-out" @click="setZoom(stepZoom(zoom, -1), null)">
          <Minus :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="sm" class="text-muted-foreground h-7 w-12 px-0 text-sm tabular-nums" :title="t('pdf.zoomReset')" :aria-label="t('pdf.zoomLevel', { percent }) + ', ' + t('pdf.zoomReset')" data-testid="pdf-zoom" @click="setZoom(1, null)">{{ percent }}%</Button>
        <Button variant="ghost" size="icon-sm" :title="t('pdf.zoomIn')" :aria-label="t('pdf.zoomIn')" data-testid="pdf-zoom-in" @click="setZoom(stepZoom(zoom, 1), null)">
          <Plus :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-pressed="fit === 'width'" :title="t('pdf.fitWidth')" :aria-label="t('pdf.fitWidth')" data-testid="pdf-fit-width" @click="fitTo('width')">
          <Columns2 :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-pressed="fit === 'page'" :title="t('pdf.fitPage')" :aria-label="t('pdf.fitPage')" data-testid="pdf-fit-page" @click="fitTo('page')">
          <Expand :stroke-width="1.5" />
        </Button>
        <span class="flex-1" />
        <Button variant="ghost" size="icon-sm" :aria-pressed="searching" :title="t('pdf.search')" :aria-label="t('pdf.search')" data-testid="pdf-search-toggle" @click="searching ? closeSearch() : openSearch()">
          <Search :stroke-width="1.5" />
        </Button>
      </div>

      <div v-if="searching" class="bg-card flex flex-wrap items-center gap-1 border-b px-2 py-1" data-testid="pdf-search">
        <Input
          v-model="query"
          type="search"
          class="h-7 min-w-32 flex-1 text-sm"
          :placeholder="t('pdf.searchPlaceholder')"
          :aria-label="t('pdf.searchField')"
          data-testid="pdf-search-input"
          @keydown.enter.prevent="step($event.shiftKey ? -1 : 1)"
        />
        <span class="text-muted-foreground min-w-16 text-sm whitespace-nowrap" role="status" data-testid="pdf-search-summary">{{ searchSummary }}</span>
        <Button variant="ghost" size="icon-sm" :disabled="!matches.length" :title="t('pdf.searchPrevious')" :aria-label="t('pdf.searchPrevious')" data-testid="pdf-search-prev" @click="step(-1)">
          <ChevronUp :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :disabled="!matches.length" :title="t('pdf.searchNext')" :aria-label="t('pdf.searchNext')" data-testid="pdf-search-next" @click="step(1)">
          <ChevronDown :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :title="t('pdf.searchClose')" :aria-label="t('pdf.searchClose')" data-testid="pdf-search-close" @click="closeSearch">
          <X :stroke-width="1.5" />
        </Button>
      </div>

      <div class="flex min-h-0 flex-1">
        <nav v-if="outlineOpen && outline.length" class="bg-card w-56 flex-none overflow-y-auto border-r p-1" :aria-label="t('pdf.outline')" data-testid="pdf-outline">
          <OutlineList :nodes="outline" @go="goToPage" />
        </nav>
        <div ref="scroller" class="bg-muted/40 relative min-w-0 flex-1 overflow-auto" tabindex="0" data-testid="pdf-scroller" @scroll.passive="onScroll" @wheel="onWheel">
          <div class="relative" :style="{ height: `${layout.height}px`, minWidth: `${columnWidth}px` }">
            <div v-for="(size, index) in sizes" :key="index" class="absolute right-0 left-0" :style="{ top: `${layout.tops[index]}px` }">
              <PdfPage
                :ref="setPageRef(index + 1)"
                :pdf="pdf!"
                :number="index + 1"
                :width="size.width"
                :height="size.height"
                :zoom="zoom"
                :near="near.has(index + 1)"
                :ranges="rangesByPage.get(index + 1) ?? noRanges"
                :current="currentMatch && currentMatch.page === index + 1 ? currentMatch : null"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
