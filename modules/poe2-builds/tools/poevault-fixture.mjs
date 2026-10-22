// Captures public PoE Vault guides as committable test fixtures.
// Usage: node tools/poevault-fixture.mjs <out-dir> <guide path under /poe2/>...
// Fetches each guide like the module does (page, planner scripts for the read action, saved trees).
// Planner data, headings, inline game names and the page structure stay verbatim; authors' prose is
// replaced by neutral words of the same length, because the guide text belongs to its authors and this
// repository is public. The page keeps only the article and the planner links, split across several
// Next.js data chunks as on the live site.
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ORIGIN = 'https://www.poe-vault.com';
const [out, ...guides] = process.argv.slice(2);
if (!out || !guides.length) throw Error('Usage: node tools/poevault-fixture.mjs <out-dir> <guide path>...');

const text = async (url, init) => { const r = await fetch(url, init); if (!r.ok) throw Error(`${url}: HTTP ${r.status}`); return r.text(); };
const pageData = html => [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)].map(m => { try { const r = JSON.parse(m[1]); return typeof r[1] === 'string' ? r[1] : ''; } catch { return ''; } }).join('');
const embeds = html => [...pageData(html).matchAll(/"embedUrl":"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`));

let action = '';
async function treeAction(uid) {
  if (action) return action;
  const tool = await text(`${ORIGIN}/poe2/tools/passive-tree?protocol=1&uid=${uid}`);
  for (const [, src] of tool.matchAll(/<script[^>]+src="(\/poe2\/_next\/static\/chunks\/[^"]+\.js)"/g)) {
    const found = /createServerReference\)\("([a-f0-9]{20,64})"[^;]{0,200}?"loadPassiveTreeBuild"/.exec(await text(ORIGIN + src));
    if (found) return action = found[1];
  }
  throw Error('loadPassiveTreeBuild not found');
}
async function savedTree(uid) {
  const body = await text(`${ORIGIN}/poe2/tools/passive-tree?protocol=1&uid=${uid}`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component', 'Next-Action': await treeAction(uid) }, body: JSON.stringify([uid]) });
  for (const line of body.split('\n')) { try { const v = JSON.parse(line.slice(line.indexOf(':') + 1)); if (v?.success) return v.build; } catch { /* Next line. */ } }
  throw Error(`tree ${uid} not loaded`);
}

const neutral = s => s.replace(/[^\s&;]+/g, word => 'x'.repeat(Math.min(word.length, 12)));
/** Article body with prose neutralised; headings and inline game tooltips keep their words. */
function scrubbedArticle(html) {
  const start = html.search(/<div[^>]*class="ArticleContent_article_content/), end = html.indexOf('</article>', start);
  if (start < 0) return '';
  let keep = 0, tooltip = 0, result = '';
  for (const m of html.slice(start, end).matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)) {
    if (m[4] !== undefined) { result += keep || tooltip ? m[4] : neutral(m[4]); continue; }
    if (!m[2]) continue;
    const name = m[2].toLowerCase(), closing = !!m[1];
    if (/^h[1-6]$/.test(name)) keep += closing ? -1 : 1;
    if (name === 'span' && !/\/\s*$/.test(m[3] || '')) { if (closing) { if (tooltip) tooltip--; } else if (tooltip || /class="[^"]*poe2-tooltip/.test(m[3] || '')) tooltip++; }
    // Links keep their place but point at the guide hub, not wherever the author linked.
    result += name === 'a' && !closing ? `<a href="${ORIGIN}/poe2">` : m[0];
  }
  return result;
}

mkdirSync(out, { recursive: true });
for (const guide of guides) {
  const url = `${ORIGIN}/poe2/${guide.replace(/^\/?(poe2\/)?/, '')}`, html = await text(url);
  const title = /<h1[^>]*>[\s\S]*?<\/h1>/.exec(html)?.[0] || '', modified = /"dateModified":"([^"]+)"/.exec(html)?.[1] || '';
  const links = embeds(html).filter(u => /\/poe2\/tools\/(passive-tree|skill-planner)\?/.test(u));
  const uids = [...new Set(links.flatMap(u => { const id = new URL(u).searchParams.getAll('uid').at(-1); return id ? [id] : []; }))];
  const trees = [];
  for (const uid of uids) trees.push(await savedTree(uid));
  const data = links.map(u => JSON.stringify({ embedUrl: u })).join(','), chunks = [];
  for (let i = 0; i < data.length; i += 700) chunks.push(`<script>self.__next_f.push(${JSON.stringify([1, data.slice(i, i + 700)])})</script>`);
  const page = `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify({ dateModified: modified })}</script></head><body><article><header>${title}</header><div class="ArticleContent_article_wrapper">${scrubbedArticle(html)}</article>${chunks.join('')}</body></html>`;
  const slug = guide.split('/').filter(Boolean).at(-1), file = join(out, slug + '.json.gz');
  writeFileSync(file, gzipSync(JSON.stringify({ url, capturedAt: new Date().toISOString(), html: page, trees }), { level: 9 }));
  console.log(file, uids.length, 'trees', links.length - uids.length, 'other planner links');
}
