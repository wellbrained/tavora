import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { TavoraSDK } from '@tavora/sdk';
import { DocumentStore } from '../../../apps/desktop/src/main/documents';
import { PanelStateStore } from '../../../apps/desktop/src/main/storage';
import { BuildRepository } from './repository';
import { validate } from './validate.js';
import { restoreView } from './view-state';

function hostDocuments(store: DocumentStore): TavoraSDK['documents'] {
 return {
  list:()=>store.list(),
  get:async<T>(id:string)=>await store.get(id) as Awaited<ReturnType<TavoraSDK['documents']['get']>> & {data:T},
  put:value=>store.put(value),
  delete:(id,options)=>store.delete(id,options?.ifRevision),
  onChange:fn=>{store.on('change',fn);return()=>{store.off('change',fn)}}
 };
}
function sample(){return {format:'tavora.build',formatVersion:1,buildId:'disk-test',build:{title:'Disk persistence test',treeVersion:'0.5',stages:[{name:'Early',passives:[],skills:[],items:[]}]},guideText:{sections:[{title:'Guide',text:'Complete supplied text.\n\nSecond paragraph.',context:'overview'}]}}}

it('reopens a saved portable build through Tavora’s real disk document store',async()=>{
 const dir=path.join(await mkdtemp(path.join(tmpdir(),'poe2-alpha-disk-')),'documents');
 const input=process.env.POE2_SMOKE_FILE?JSON.parse(await readFile(process.env.POE2_SMOKE_FILE,'utf8')):sample();
 const original=validate(input),first=new BuildRepository(hostDocuments(new DocumentStore(dir)));
 const id=await first.put(original);
 // A fresh store simulates a new host process, without opening or controlling any app.
 const reopened=new BuildRepository(hostDocuments(new DocumentStore(dir)));
 expect(await reopened.get(id)).toEqual(original);
 expect(await reopened.list()).toHaveLength(1);
 const otherPanel=new BuildRepository(hostDocuments(new DocumentStore(dir)));
 expect((await otherPanel.get(id))?.guideText?.sections).toEqual(original.guideText?.sections);
});

it('persists independent panel variants and Guide section across store reconstruction',async()=>{
 const dir=path.join(await mkdtemp(path.join(tmpdir(),'poe2-alpha-panels-')),'panels');
 const first=new PanelStateStore(dir),tree='11111111-1111-4111-8111-111111111111',skills='22222222-2222-4222-8222-222222222222',guide='33333333-3333-4333-8333-333333333333';
 const treeView = {...restoreView({build:'poe2-build-disk-test',stage:0,weapon:'2',search:'cold',notes:true,disclosures:{tree:false},treeInfo:true})};
 await first.set(tree,treeView);
 await first.set(skills,{build:'poe2-build-disk-test',stage:4,section:0});
 await first.set(guide,{build:'poe2-build-disk-test',stage:4,section:2});
 const reopened=new PanelStateStore(dir);
 expect(restoreView(await reopened.get(tree))).toEqual(treeView);
 expect(await reopened.get(skills)).toEqual({build:'poe2-build-disk-test',stage:4,section:0});
 expect(await reopened.get(guide)).toEqual({build:'poe2-build-disk-test',stage:4,section:2});
});
