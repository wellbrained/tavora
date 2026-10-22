import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,utimes} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {detectSaveDirectory,saveDialogDirectory} from './save-dialog-folder';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const home=await mkdtemp(path.join(os.tmpdir(),'save-folders-'));roots.push(home);return{home,platform:'win32' as const,steamDirectory:path.join(home,'Steam')};}
async function save(dir:string,name:string,time:number){await mkdir(dir,{recursive:true});const file=path.join(dir,name);await writeFile(file,'synthetic');await utimes(file,time,time);}
it('checks only known game directories, choosing the one with the newest valid current save',async()=>{
 const options=await setup(),local=path.join(options.home,'Saved Games','keen games','Enshrouded','default'),cloud=path.join(options.steamDirectory,'userdata','123','1203620','remote');
 await save(local,'character0.ksd',1000);await save(cloud,'world1.ksd',2000);
 await save(path.join(options.steamDirectory,'userdata','not-an-account','1203620','remote'),'character0.ksd',3000);
 await save(local,'global.ksd',4000);await save(path.join(local,'backup'),'world0.ksd',5000);
 expect(await detectSaveDirectory('enshrouded',options)).toBe(cloud);
 expect(await detectSaveDirectory('another-game',options)).toBeUndefined();
});
it('uses a remembered folder before detection and degrades to the normal picker when none exists',async()=>{
 const options=await setup(),remembered=path.join(options.home,'custom');
 expect(await saveDialogDirectory({lastPickedDirectory:async()=>remembered},'enshrouded',options)).toBe(remembered);
 expect(await saveDialogDirectory({lastPickedDirectory:async()=>undefined},'enshrouded',options)).toBeUndefined();
 const local=path.join(options.home,'Saved Games','keen games','Enshrouded','default');await save(local,'world0.ksd',1000);
 expect(await saveDialogDirectory({lastPickedDirectory:async()=>undefined},'enshrouded',options)).toBe(local);
});
