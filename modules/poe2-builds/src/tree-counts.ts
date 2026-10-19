import type { Stage } from './model';
/** Shared points contribute once to Total, never to the weapon-specific counts. */
export function allocationCounts(passives: Stage['passives']) {
 return { total: new Set(passives.map(p=>p.id)).size,
  set1: new Set(passives.filter(p=>p.weapon===1).map(p=>p.id)).size,
  set2: new Set(passives.filter(p=>p.weapon===2).map(p=>p.id)).size };
}
