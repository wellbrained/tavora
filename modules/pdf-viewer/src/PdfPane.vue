<script setup lang="ts">
// One open PDF: a toolbar, small pictures of the pages or the contents list on the side, and the pages in one long scroll.
// It remembers the page, zoom and side per file (the parent saves what it reports) and searches the whole text.
// Page Up and Page Down, the arrow keys left and right, Home and End jump by whole pages, and Ctrl+F searches. The keys
// act on this pane only (they are heard on its own element), so a second pane next to it is left alone.
// In a narrow panel the side does not sit beside the pages but takes their place until a page is picked.
// Links on a page jump to their page here; web addresses go up to the parent (`openLink`), which hands them to Tavora.
// A PDF with a password asks for it in the pane; cancelling closes the file (`cancel`). The password is never kept.
// Fit width and fit page use the whole document (the widest or largest page), so the zoom stays put while scrolling.
import { ChevronDown, ChevronUp, Columns2, Expand, GalleryVerticalEnd, ListTree, LockKeyhole, Minus, Plus, Search, X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Progress } from "@tavora/official-ui/components/ui/progress";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Toggle, ToggleGroup } from "@tavora/official-ui/components/ui/toggle";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import OutlineList from "./OutlineList.vue";
import PdfPage from "./PdfPage.vue";
import PdfThumbs from "./PdfThumbs.vue";
import { clampZoom, type FileView, type FitMode, type SideMode } from "./files";
import { t } from "./i18n";
import { fitZoomAll, layoutPages, pageAtOffset, pagesInBand, PAGE_GAP, parsePageInput, stepZoom, type PageSize } from "./layout";
import { namedPage, type LinkTarget } from "./links";
import { closePdf, destinationPage, loadOutline, openPdf, PdfProblem, type OutlineNode, type PDFDocumentProxy } from "./pdf";
import { buildPageText, findMatches, firstMatchFrom, stepMatch, type Match, type PageText, type Range } from "./search";

const props = defineProps<{ url: string; view: FileView }>();
const emit = defineEmits<{ view: [view: Partial<FileView>]; openLink: [url: string]; cancel: [] }>();

type Status = "opening" | "ready" | "gone" | "password" | "broken";

const status = ref<Status>("opening");
const pdf = shallowRef<PDFDocumentProxy | null>(null);
const sizes = ref<PageSize[]>([]);
const outline = ref<OutlineNode[]>([]);
const side = ref<SideMode>(props.view.side);
const zoom = ref(clampZoom(props.view.zoom));
const fit = ref<FitMode>(props.view.fit);
const page = ref(1);
const pageField = ref("1");
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const searchInput = ref<InstanceType<typeof Input> | null>(null);
/** How far the opening is, in percent (the page sizes are read first). */
const progress = ref(0);

const panelWidth = ref(Infinity);
const viewport = reactive({ top: 0, height: 0, width: 0 });
const pageRefs = new Map<number, InstanceType<typeof PdfPage>>();

/** Below this width (CSS pixels) the side no longer fits next to the pages. */
const NARROW = 480;

let loadToken = 0;
let restoring = true;

const narrow = computed(() => panelWidth.value < NARROW);
const covered = computed(() => narrow.value && side.value !== null && (side.value === "pages" || outline.value.length > 0));
const count = computed(() => sizes.value.length);
const layout = computed(() => layoutPages(sizes.value, zoom.value));
const columnWidth = computed(() => Math.max(0, ...sizes.value.map((size) => size.width)) * zoom.value + PAGE_GAP * 2);
const near = computed(() => new Set(pagesInBand(layout.value.tops, sizes.value, zoom.value, viewport.top - viewport.height, viewport.top + viewport.height * 2)));

// ── Opening

async function load() {
  const mine = ++loadToken;
  status.value = "opening";
  progress.value = 0;
  restoring = true;
  void closePdf(pdf.value);
  pdf.value = null;
  try {
    const opened = await openPdf(props.url, askPassword);
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
      progress.value = Math.round((found.length / opened.numPages) * 100);
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
    // Keys need the focus inside this pane; when nothing has it yet, it starts on the pages.
    if (document.activeElement === document.body) scroller.value?.focus({ preventScroll: true });
    // What the scroll reports while the page is being put in place is not the reader's doing.
    setTimeout(() => (restoring = false), 150);
  } catch (error) {
    const kind = error instanceof PdfProblem ? error.kind : "broken";
    if (mine !== loadToken || kind === "cancelled") return;
    status.value = kind;
  }
}

// ── Password

const passwordField = ref("");
const passwordWrong = ref(false);
const passwordInput = ref<InstanceType<typeof Input> | null>(null);
let passwordReply: ((password: string | null) => void) | null = null;

/** pdf.js needs the password: the pane asks for it and waits for Open or Cancel. */
async function askPassword(wrong: boolean): Promise<string | null> {
  status.value = "password";
  passwordWrong.value = wrong;
  passwordField.value = "";
  const answer = new Promise<string | null>((resolve) => (passwordReply = resolve));
  await nextTick();
  (passwordInput.value?.$el as HTMLInputElement | undefined)?.focus();
  return answer;
}

/** Open (with the password) or Cancel (null). The field is emptied right away, so the password is not kept. */
function answerPassword(password: string | null) {
  const reply = passwordReply;
  passwordReply = null;
  passwordField.value = "";
  if (password === null) {
    reply?.(null);
    emit("cancel");
    return;
  }
  status.value = "opening";
  reply?.(password);
}

onMounted(() => {
  void load();
  if (!root.value) return;
  panelWidth.value = root.value.clientWidth || Infinity;
  paneResizer = new ResizeObserver(() => (panelWidth.value = root.value?.clientWidth || Infinity));
  paneResizer.observe(root.value);
});

onBeforeUnmount(() => {
  loadToken++;
  passwordReply?.(null);
  resizer?.disconnect();
  paneResizer?.disconnect();
  void closePdf(pdf.value);
});

let resizer: ResizeObserver | null = null;
let paneResizer: ResizeObserver | null = null;
watch(scroller, (element) => {
  resizer?.disconnect();
  if (!element) return;
  resizer = new ResizeObserver(() => {
    // The pages are not shown (the side has their place): nothing to measure.
    if (element.clientWidth === 0) return;
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

/** Works out the fit again (the panel changed size). */
function refit() {
  const mode = fit.value;
  const element = scroller.value;
  if (!mode || !element || !count.value) return;
  const next = fitZoomAll(mode, sizes.value, { width: element.clientWidth, height: element.clientHeight });
  if (Math.abs(next - zoom.value) > 0.001) void setZoom(next, mode);
}

function fitTo(mode: "width" | "page") {
  const element = scroller.value;
  if (!element || !count.value) return;
  void setZoom(fitZoomAll(mode, sizes.value, { width: element.clientWidth, height: element.clientHeight }), mode);
}

// ── Links

/** A link on a page was clicked. A web address goes up right away, while the click still counts for Tavora. */
async function followLink(target: LinkTarget) {
  if (target.kind === "web") return emit("openLink", target.url);
  if (target.kind === "named") return goToPage(namedPage(target.action, page.value, count.value));
  const document = pdf.value;
  const number = document ? await destinationPage(document, target.dest) : null;
  if (number !== null && document === pdf.value) goToPage(number);
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
  const input = searchInput.value?.$el as HTMLInputElement | undefined;
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
  } else if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey && !typingIn(event.target)) {
    const target = pageKeys[event.key]?.();
    if (target === undefined || Number.isNaN(target)) return;
    event.preventDefault();
    goToPage(target);
  }
}

/** Keys that jump by whole pages, to the page they lead to. */
const pageKeys: Record<string, () => number> = {
  PageDown: () => page.value + 1,
  PageUp: () => page.value - 1,
  ArrowRight: () => (sideways() ? NaN : page.value + 1),
  ArrowLeft: () => (sideways() ? NaN : page.value - 1),
  Home: () => 1,
  End: () => count.value,
};

/** Zoomed in wider than the panel: the arrow keys left and right move sideways, as they normally do. */
const sideways = () => !!scroller.value && scroller.value.scrollWidth > scroller.value.clientWidth + 1;

/** Keys pressed while typing in a field, a dialog or a menu are not for the pages. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu]") !== null;
}

/** The side buttons are one choice or none: the button pressed now is the one that was not on. */
function chooseSide(pressed: Exclude<SideMode, null>[]) {
  side.value = pressed.find((mode) => mode !== side.value) ?? null;
  emit("view", { side: side.value });
}

function chooseFit(pressed: ("width" | "page")[]) {
  const next = pressed.find((mode) => mode !== fit.value);
  if (next) fitTo(next);
  else void setZoom(zoom.value, null);
}

/** A page picked on the side. Where the side has the pages' place, it steps aside first. */
async function goFromSide(target: number) {
  if (narrow.value) {
    side.value = null;
    emit("view", { side: null });
    await nextTick();
    measure();
  }
  goToPage(target);
}

const sideOptions = computed(() => [
  { value: "pages" as const, label: t("pdf.pages"), icon: GalleryVerticalEnd, testid: "pdf-thumbs-toggle" },
  ...(outline.value.length ? [{ value: "contents" as const, label: t("pdf.outline"), icon: ListTree, testid: "pdf-outline-toggle" }] : []),
]);
const fitOptions = computed(() => [
  { value: "width" as const, label: t("pdf.fitWidth"), icon: Columns2, testid: "pdf-fit-width" },
  { value: "page" as const, label: t("pdf.fitPage"), icon: Expand, testid: "pdf-fit-page" },
]);

const percent = computed(() => Math.round(zoom.value * 100));
const setPageRef = (number: number) => (element: unknown) => {
  if (element) pageRefs.set(number, element as InstanceType<typeof PdfPage>);
  else pageRefs.delete(number);
};
</script>

<template>
  <div ref="root" class="flex h-full min-h-0 flex-col outline-none" tabindex="-1" data-testid="pdf-pane" @keydown="onKey">
    <Notice v-if="status === 'gone' || status === 'broken'" variant="error" class="m-3" data-testid="pdf-error">
      {{ status === "gone" ? t("pdf.fileGone") : t("pdf.failed") }}
      <template v-if="status === 'broken'" #action>
        <Button size="sm" variant="secondary" @click="load">{{ t("pdf.retry") }}</Button>
      </template>
    </Notice>
    <div v-else-if="status === 'password'" class="flex h-full items-center justify-center p-4">
      <form class="flex w-full max-w-xs flex-col gap-3" data-testid="pdf-password" @submit.prevent="answerPassword(passwordField)" @keydown.esc.prevent="answerPassword(null)">
        <div class="flex items-center gap-2">
          <LockKeyhole class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
          <p class="text-sm font-medium">{{ t("pdf.password") }}</p>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="pdf-password-input">{{ t("pdf.passwordField") }}</Label>
          <Input
            id="pdf-password-input"
            ref="passwordInput"
            v-model="passwordField"
            type="password"
            autocomplete="off"
            :aria-invalid="passwordWrong || undefined"
            :aria-describedby="passwordWrong ? 'pdf-password-wrong' : undefined"
            data-testid="pdf-password-input"
          />
          <p v-if="passwordWrong" id="pdf-password-wrong" class="text-destructive text-xs" role="alert" data-testid="pdf-password-wrong">{{ t("pdf.passwordWrong") }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="secondary" data-testid="pdf-password-cancel" @click="answerPassword(null)">{{ t("cancel") }}</Button>
          <Button type="submit" :disabled="!passwordField" data-testid="pdf-password-open">{{ t("pdf.passwordOpen") }}</Button>
        </div>
      </form>
    </div>
    <div v-else-if="status === 'opening'" class="flex flex-col gap-2 p-4" data-testid="pdf-opening">
      <Progress :model-value="progress" :aria-label="t('pdf.progress')" />
      <p class="text-muted-foreground text-sm">{{ t("pdf.opening") }}</p>
    </div>

    <template v-else>
      <div class="bg-card flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1" role="toolbar" :aria-label="t('pdf.toolbar')">
        <ToggleGroup :model-value="side ? [side] : []" :options="sideOptions" :label="t('pdf.pages') + ', ' + t('pdf.outline')" @update:model-value="chooseSide" />
        <Button variant="ghost" size="icon" :disabled="page <= 1" :title="t('pdf.previous')" :aria-label="t('pdf.previous')" data-testid="pdf-prev" @click="goToPage(page - 1)">
          <ChevronUp :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon" :disabled="page >= count" :title="t('pdf.next')" :aria-label="t('pdf.next')" data-testid="pdf-next" @click="goToPage(page + 1)">
          <ChevronDown :stroke-width="1.5" />
        </Button>
        <form class="flex items-center gap-2" @submit.prevent="submitPage">
          <Input v-model="pageField" inputmode="numeric" class="w-14 px-1 text-center" :aria-label="t('pdf.page')" data-testid="pdf-page-input" @blur="submitPage" />
          <span class="text-muted-foreground text-sm whitespace-nowrap tabular-nums">{{ t("pdf.of", { count }) }}</span>
        </form>
        <Separator orientation="vertical" class="data-[orientation=vertical]:h-4 mx-1" />
        <Button variant="ghost" size="icon" :title="t('pdf.zoomOut')" :aria-label="t('pdf.zoomOut')" data-testid="pdf-zoom-out" @click="setZoom(stepZoom(zoom, -1), null)">
          <Minus :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" class="text-muted-foreground w-14 px-0 tabular-nums" :title="t('pdf.zoomReset')" :aria-label="t('pdf.zoomLevel', { percent }) + ', ' + t('pdf.zoomReset')" data-testid="pdf-zoom" @click="setZoom(1, null)">{{ percent }}%</Button>
        <Button variant="ghost" size="icon" :title="t('pdf.zoomIn')" :aria-label="t('pdf.zoomIn')" data-testid="pdf-zoom-in" @click="setZoom(stepZoom(zoom, 1), null)">
          <Plus :stroke-width="1.5" />
        </Button>
        <ToggleGroup :model-value="fit ? [fit] : []" :options="fitOptions" :label="t('pdf.fitWidth') + ', ' + t('pdf.fitPage')" @update:model-value="chooseFit" />
        <span class="flex-1" />
        <Toggle :model-value="searching" :label="t('pdf.search')" data-testid="pdf-search-toggle" @update:model-value="searching ? closeSearch() : openSearch()">
          <Search class="size-4" :stroke-width="1.5" />
        </Toggle>
      </div>

      <div v-if="searching" class="bg-card flex shrink-0 items-center gap-1 border-b px-2 py-1" data-testid="pdf-search">
        <Input
          ref="searchInput"
          v-model="query"
          type="search"
          class="min-w-0 flex-1"
          :placeholder="t('pdf.searchPlaceholder')"
          :aria-label="t('pdf.searchField')"
          data-testid="pdf-search-input"
          @keydown.enter.prevent="step($event.shiftKey ? -1 : 1)"
        />
        <span class="text-muted-foreground min-w-16 text-sm whitespace-nowrap" role="status" data-testid="pdf-search-summary">{{ searchSummary }}</span>
        <Button variant="ghost" size="icon" :disabled="!matches.length" :title="t('pdf.searchPrevious')" :aria-label="t('pdf.searchPrevious')" data-testid="pdf-search-prev" @click="step(-1)">
          <ChevronUp :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon" :disabled="!matches.length" :title="t('pdf.searchNext')" :aria-label="t('pdf.searchNext')" data-testid="pdf-search-next" @click="step(1)">
          <ChevronDown :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon" :title="t('pdf.searchClose')" :aria-label="t('pdf.searchClose')" data-testid="pdf-search-close" @click="closeSearch">
          <X :stroke-width="1.5" />
        </Button>
      </div>

      <div class="relative flex min-h-0 flex-1">
        <div ref="scroller" class="bg-muted/40 relative min-w-0 flex-1 overflow-auto" tabindex="0" :inert="covered" data-testid="pdf-scroller" @scroll.passive="onScroll" @wheel="onWheel">
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
                @link="followLink"
              />
            </div>
          </div>
        </div>
        <!-- Beside the pages when there is room; otherwise it takes their place until a page is picked. -->
        <PdfThumbs v-if="side === 'pages' && pdf" :class="narrow ? 'absolute inset-0' : 'order-first w-40 flex-none border-r'" :pdf="pdf" :sizes="sizes" :page="page" @go="goFromSide" />
        <div v-else-if="side === 'contents' && outline.length" class="bg-card overflow-y-auto p-1" :class="narrow ? 'absolute inset-0' : 'order-first w-56 flex-none border-r'" data-testid="pdf-outline">
          <OutlineList :nodes="outline" @go="goFromSide" />
        </div>
      </div>
    </template>
  </div>
</template>
