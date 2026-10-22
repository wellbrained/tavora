import { portable, type Build, type Stage } from './model';
import { validate } from './validate.js';

export interface VariantChanges { added:string[]; removed:string[]; changed:string[]; same:number }

/** Saved variant index -> candidate variant index. Source variant ID first, then the exact name; positions never count. */
export function matchVariants(saved:Build,candidate:Build):Map<number,number> {
 const savedIds=saved.guideImport?.variantIds||[],candidateIds=candidate.guideImport?.variantIds||[];
 const matches=new Map<number,number>(),used=new Set<number>();
 saved.stages.forEach((_,i)=>{const j=savedIds[i]?candidateIds.indexOf(savedIds[i]!):-1;if(j>=0&&!used.has(j)){matches.set(i,j);used.add(j);}});
 saved.stages.forEach((stage,i)=>{
  if(matches.has(i))return;
  // A candidate whose ID belongs to another saved variant is that variant, not a rename of this one.
  const j=candidate.stages.findIndex((s,k)=>!used.has(k)&&s.label===stage.label&&!(candidateIds[k]&&savedIds.includes(candidateIds[k]!)));
  if(j>=0){matches.set(i,j);used.add(j);}
 });
 return matches;
}

const content=(s:Stage)=>JSON.stringify([s.label,s.items,s.skills,s.passives]);
export function variantChanges(saved:Build,fresh:Build):VariantChanges {
 // Saved builds went through validate; compare the fresh import in the same shape.
 const candidate=validate(portable(fresh)),matches=matchVariants(saved,candidate),matched=new Set(matches.values());
 const changed=[...matches].filter(([i,j])=>content(saved.stages[i]!)!==content(candidate.stages[j]!)).map(([,j])=>candidate.stages[j]!.label);
 return {
  added:candidate.stages.filter((_,j)=>!matched.has(j)).map(s=>s.label),
  removed:saved.stages.filter((_,i)=>!matches.has(i)).map(s=>s.label),
  changed,same:matches.size-changed.length,
 };
}

/** The variant you had open, if the update still has it. */
export function keptVariant(saved:Build,candidate:Build,open:number):number|undefined { return matchVariants(saved,candidate).get(open); }
