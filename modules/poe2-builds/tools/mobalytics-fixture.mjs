// Turns captured public Mobalytics guide documents into committable test fixtures.
// Usage: node tools/mobalytics-fixture.mjs <capture.json> <out-dir>
// The capture maps slug -> {url, capturedAt, document} (the guide's PRELOADED_STATE document).
// Game data, structure and IDs stay verbatim; authors' prose is replaced by neutral words of the
// same length, because the guide text belongs to its authors and this repository is public.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const [capture, out] = process.argv.slice(2);
if (!capture || !out) throw Error('Usage: node tools/mobalytics-fixture.mjs <capture.json> <out-dir>');
const DROP = new Set(['NgfDocumentCmWidgetDiscoveryPreviewCompactV2', 'NgfDocumentCmWidgetCommentsV1', 'NgfDocumentCmWidgetPromoBannerHorizontalV1']);
const PROSE = new Set(['notes']);

const neutral = text => text.replace(/\S+/g, word => 'x'.repeat(Math.min(word.length, 12)));
function scrub(value, key = '') {
  if (Array.isArray(value)) return value.map(entry => scrub(entry, key));
  if (!value || typeof value !== 'object') return typeof value === 'string' && PROSE.has(key) && !/^[a-z0-9-]+$/.test(value) ? neutral(value) : value;
  // Lexical text nodes hold the author's words; inline game references (static-data-widget) stay.
  if (value.type === 'text' && typeof value.text === 'string') return { ...value, text: neutral(value.text) };
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
}

mkdirSync(out, { recursive: true });
for (const [slug, entry] of Object.entries(JSON.parse(readFileSync(capture, 'utf8')))) {
  const document = entry.document;
  const fixture = { url: entry.url, capturedAt: entry.capturedAt, document: scrub({ ...document, content: document.content.filter(c => !DROP.has(c.__typename)) }) };
  const file = join(out, slug + '.json.gz');
  writeFileSync(file, gzipSync(JSON.stringify(fixture), { level: 9 }));
  console.log(file);
}
