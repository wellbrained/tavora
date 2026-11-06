// The websites a module may reach, shortened for the overview in Settings > Connections: one chip per site (the
// registrable domain, TLD kept: `cdn.mobalytics.gg` shows as `mobalytics.gg`), with every full host behind it for the
// chip's tooltip. Only a summary: the consent prompt and anything that grants access keep the full hosts.
import { getDomain } from "tldts";

export interface SiteGroup {
  /** What the chip says: the base site, or the host itself when it has none (`localhost:3000`, an IP address). */
  site: string;
  /** Every granted host behind the chip, in the order the module lists them. */
  hosts: string[];
}

/** The base site of a host, or the host itself for a port, an IP address or anything without a public suffix. */
export function siteOf(host: string): string {
  if (host.includes(":")) return host;
  // Private suffixes count, so two `github.io` sites stay apart.
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

/** Hosts merged by base site, in the order each site first appears. */
export function siteGroups(hosts: readonly string[]): SiteGroup[] {
  const groups = new Map<string, SiteGroup>();
  for (const host of hosts) {
    const site = siteOf(host);
    const group = groups.get(site);
    if (!group) groups.set(site, { site, hosts: [host] });
    else if (!group.hosts.includes(host)) group.hosts.push(host);
  }
  return [...groups.values()];
}
