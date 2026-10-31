import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, open, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';import { tmpdir } from 'node:os';
import { ReadOnlyFiles,MAX_READ_ONLY_BYTES } from './read-only-files';
import { serveReadOnlyFile } from './read-only-files-http';
import { deleteModuleData,deleteModuleDataOf,listModuleData } from './module-data';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const root=await mkdtemp(path.join(tmpdir(),'tavora-picked-'));roots.push(root);const file=path.join(root,'world0.ksd');await writeFile(file,'first');const files=new ReadOnlyFiles(root,'local','local.test.map','enshrouded');return{root,file,files};}
it('rereads changed bytes across restart without returning paths or changing the source',async()=>{const {root,file,files}=await setup();const ref=await files.remember(file);expect(ref).toMatchObject({name:'world0.ksd',size:5});expect(Object.keys(ref).sort()).toEqual(['id','name','size']);await writeFile(file,'updated');expect((await new ReadOnlyFiles(root,'local','local.test.map','enshrouded').read(ref.id)).toString()).toBe('updated');expect(await readFile(file,'utf8')).toBe('updated');});
it('isolates game, module and publisher and rejects arbitrary path input',async()=>{const{root,file,files}=await setup();const ref=await files.remember(file);for(const other of [new ReadOnlyFiles(root,'local','local.test.map','poe2'),new ReadOnlyFiles(root,'local','local.other.map','enshrouded'),new ReadOnlyFiles(root,'official','local.test.map','enshrouded')])await expect(other.read(ref.id)).rejects.toThrow('no longer linked');await expect(files.read(file)).rejects.toThrow('Invalid file reference');});
it('forgets access without deleting a file and handles moved files',async()=>{const{file,files}=await setup();const ref=await files.remember(file);await files.forget(ref.id);await expect(files.read(ref.id)).rejects.toThrow('no longer linked');expect(await readFile(file,'utf8')).toBe('first');const next=await files.remember(file);await rm(file);await expect(files.read(next.id)).rejects.toThrow('may have moved');});
it('rejects directories and oversized or growing files with bounded allocation',async()=>{const{root,file,files}=await setup();await expect(files.remember(root)).rejects.toThrow('not a folder');const handle=await open(file,'r+');await handle.truncate(MAX_READ_ONLY_BYTES+1);await handle.close();await expect(files.remember(file)).rejects.toThrow('50 MB');});
it('serializes simultaneous selections instead of losing file references',async()=>{const{file,files}=await setup();const refs=await Promise.all([files.remember(file),files.remember(file)]);expect(refs[0].id).not.toBe(refs[1].id);for(const ref of refs)expect((await files.read(ref.id)).toString()).toBe('first');});
it('revokes file access when game or module data is deleted',async()=>{const{root,file,files}=await setup();const ref=await files.remember(file);expect(await listModuleData(root)).toContainEqual({owner:'local',moduleId:'local.test.map'});await deleteModuleData(root,'enshrouded');await expect(files.read(ref.id)).rejects.toThrow('no longer linked');const next=await files.remember(file);await deleteModuleDataOf(root,'local','local.test.map');await expect(files.read(next.id)).rejects.toThrow('no longer linked');expect(await readFile(file,'utf8')).toBe('first');});
it('rejects a redirected directory junction',async()=>{const{root,files}=await setup();const a=path.join(root,'a'),b=path.join(root,'b'),link=path.join(root,'link');await mkdir(a);await mkdir(b);await writeFile(path.join(a,'save.ksd'),'a');await writeFile(path.join(b,'save.ksd'),'b');await symlink(a,link,process.platform==='win32'?'junction':'dir');const ref=await files.remember(path.join(link,'save.ksd'));await rm(link);await symlink(b,link,process.platform==='win32'?'junction':'dir');await expect(files.read(ref.id)).rejects.toThrow('points somewhere else');});
it('serves only POST binary reads with no-store and does not expose internal errors',async()=>{const{file,files}=await setup();const ref=await files.remember(file);const response=await serveReadOnlyFile(new Request('https://module/read',{method:'POST'}),ref.id,files);expect(response.status).toBe(200);expect(await response.text()).toBe('first');expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect((await serveReadOnlyFile(new Request('https://module/read'),ref.id,files)).status).toBe(405);const error=await serveReadOnlyFile(new Request('https://module/read',{method:'POST'}),ref.id,{read:async()=>{throw Error('/private/path');}});expect(await error.text()).not.toContain('/private/path');});

it('recovers broken reference metadata only after a fresh explicit file selection',async()=>{const{root,file,files}=await setup();const before=await files.remember(file);await writeFile(path.join(root,'read-only-files','local','local.test.map','enshrouded','sources.json'),'broken');await expect(files.read(before.id)).rejects.toThrow('unavailable');const after=await files.remember(file);expect((await files.read(after.id)).toString()).toBe('first');await expect(files.read(before.id)).rejects.toThrow('no longer linked');});
it('does not grant access when the originating panel closes before the selection completes',async()=>{const{file,files}=await setup();let allowed=true;const selection=files.remember(file,()=>allowed);allowed=false;await expect(selection).rejects.toThrow('no longer active');});

it('bounds metadata lookup and file reads before I/O, per scope and across the host',async()=>{
 const {root,file,files}=await setup(),ref=await files.remember(file);
 const first=await Promise.allSettled([files.read(ref.id),files.read(ref.id),files.read(ref.id)]);expect(first.filter(x=>x.status==='fulfilled')).toHaveLength(2);expect(first.filter(x=>x.status==='rejected')).toHaveLength(1);
 const stores=Array.from({length:5},(_,i)=>new ReadOnlyFiles(root,'local','local.test.map','game-'+i));const refs=await Promise.all(stores.map(store=>store.remember(file)));const all=await Promise.allSettled(stores.map((store,i)=>store.read(refs[i]!.id)));expect(all.filter(x=>x.status==='fulfilled')).toHaveLength(4);expect(all.filter(x=>x.status==='rejected')).toHaveLength(1);
 const invalid=await Promise.allSettled([files.read('f'.repeat(32)),files.read('e'.repeat(32)),files.read('d'.repeat(32))]);expect(invalid.some(x=>x.status==='rejected'&&x.reason.code==='QUOTA_EXCEEDED')).toBe(true);
});

it('remembers the picker directory across restart and forgetting a reference, scoped to its game and module',async()=>{
 const {root,file,files}=await setup();
 expect(await files.lastPickedDirectory()).toBeUndefined();
 const ref=await files.remember(file);await files.forget(ref.id);
 expect(await new ReadOnlyFiles(root,'local','local.test.map','enshrouded').lastPickedDirectory()).toBe(root);
 expect(await new ReadOnlyFiles(root,'local','local.test.map','other-game').lastPickedDirectory()).toBeUndefined();
 expect(await new ReadOnlyFiles(root,'local','local.other.map','enshrouded').lastPickedDirectory()).toBeUndefined();
 const sub=path.join(root,'another');await mkdir(sub);await writeFile(path.join(sub,'character0.ksd'),'new');
 await files.remember(path.join(sub,'character0.ksd'));expect(await files.lastPickedDirectory()).toBe(sub);
 await rm(sub,{recursive:true});expect(await files.lastPickedDirectory()).toBeUndefined();
});
it('ignores corrupt picker hints and retains old reference-directory compatibility',async()=>{
 const {root,file,files}=await setup();await files.remember(file);
 await writeFile(path.join(root,'read-only-files','local','local.test.map','enshrouded','picker.json'),'broken');
 expect(await files.lastPickedDirectory()).toBe(root);
});
it('checks a linked file without reading it: found with size and change time, gone, or not linked here',async()=>{const{root,file,files}=await setup();const ref=await files.remember(file);const first=await files.check(ref.id);expect(first).toMatchObject({found:true,size:5});await writeFile(file,'a longer text');const changed=await files.check(ref.id);expect(changed).toMatchObject({found:true,size:13});await rm(file);expect(await files.check(ref.id)).toEqual({found:false,reason:'gone'});expect(await new ReadOnlyFiles(root,'local','local.other.map','enshrouded').check(ref.id)).toEqual({found:false,reason:'unlinked'});await expect(files.check('not-an-id')).rejects.toThrow('Invalid file reference');});
it('locates only a linked file that is still there',async()=>{const{file,files}=await setup();const ref=await files.remember(file);expect(await files.locate(ref.id)).toBe(await realpath(file));await rm(file);await expect(files.locate(ref.id)).rejects.toThrow('may have moved');await files.forget(ref.id);await expect(files.locate(ref.id)).rejects.toThrow('no longer linked');});

it('starts the picker next to a linked file, folders higher, but only for its own files',async()=>{
 const {root,files}=await setup();const deep=path.join(root,'world','Players');await mkdir(deep,{recursive:true});const save=path.join(deep,'player.sav');await writeFile(save,'p');
 const ref=await files.remember(save);
 expect(await files.directoryNear(ref.id,0)).toBe(deep);
 expect(await files.directoryNear(ref.id,1)).toBe(path.join(root,'world'));
 expect(await files.directoryNear(ref.id,9)).toBe(path.dirname(path.dirname(path.join(root,'world'))));
 expect(await new ReadOnlyFiles(root,'local','local.other.map','enshrouded').directoryNear(ref.id,1)).toBeUndefined();
 expect(await files.directoryNear('nope',1)).toBeUndefined();
});
