// Builds src/poevault-gems.json: PoE Vault's gem planner links store gems as Icy Veins index numbers,
// and the numbering can change between game versions.
// Usage: node tools/poevault-gems.mjs
// VERSIONS is the skill planner's own version list. Versions that number every gem the same share one
// table. Entries are [name, game id without "Metadata/Items/Gems/", kind] with kind 1 = support.
import { writeFileSync } from 'node:fs';

const VERSIONS = ['0.5.2.1', '0.5.1.1', '0.5.0.1', '0.4.0.13', '0.4.0', '0.3.0v2', '0.3.0', '0.2.1b'];
const PREFIX = 'Metadata/Items/Gems/';
const load = async version => {
  const lists = await Promise.all(['skill_gems', 'support_gems'].map(async file => {
    const response = await fetch(`https://wp.icy-veins.com/static/poe/data/${version}/${file}.json`);
    if (!response.ok) throw Error(`${version}/${file}: HTTP ${response.status}`);
    return response.json();
  }));
  const table = {};
  for (const gem of lists.flat()) table[gem.idx] = [gem.name, String(gem.id || '').replace(PREFIX, ''), gem.gem_type === 1 ? 1 : 0];
  return table;
};
// Same numbering: no index means a different gem in the two versions. Newer versions may add gems.
const compatible = (a, b) => Object.keys(b).every(i => !a[i] || a[i][1] === b[i][1]);

const tables = [];
for (const version of VERSIONS) {
  const gems = await load(version), shared = tables.find(t => compatible(t.gems, gems));
  if (shared) { shared.versions.push(version); for (const [i, entry] of Object.entries(gems)) shared.gems[i] ??= entry; }
  else tables.push({ versions: [version], gems });
}
for (const t of tables) console.log(t.versions.join(', '), Object.keys(t.gems).length, 'gems');
writeFileSync(new URL('../src/poevault-gems.json', import.meta.url), JSON.stringify(tables) + '\n');
