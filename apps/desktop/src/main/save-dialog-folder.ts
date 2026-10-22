import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findSteamDir } from './steam-icons';

interface FolderOptions { home?:string; platform?:NodeJS.Platform; steamDirectory?:string|null }
/** Bounded game-specific hints only; detection grants no file or directory access. */
export async function detectSaveDirectory(gameId:string, options:FolderOptions = {}):Promise<string|undefined> {
  if (gameId !== 'enshrouded') return undefined;
  const candidates:string[] = [], home=options.home ?? os.homedir();
  if ((options.platform ?? process.platform) === 'win32') candidates.push(path.join(home,'Saved Games','keen games','Enshrouded','default'));
  const steam=options.steamDirectory === undefined ? await findSteamDir() : options.steamDirectory;
  if (steam) {
    const accounts=await readdir(path.join(steam,'userdata'),{withFileTypes:true}).catch(()=>[]);
    for (const account of accounts.filter(a=>a.isDirectory() && /^\d+$/.test(a.name)).slice(0,200)) candidates.push(path.join(steam,'userdata',account.name,'1203620','remote'));
  }
  let newest:{directory:string;modified:number}|undefined;
  for (const directory of candidates) {
    const files=await readdir(directory,{withFileTypes:true}).catch(()=>[]);
    for (const file of files.filter(f=>f.isFile() && /^(character|world)\d+\.ksd$/i.test(f.name)).slice(0,200)) {
      const modified=(await stat(path.join(directory,file.name)).catch(()=>null))?.mtimeMs;
      if (modified !== undefined && (!newest || modified > newest.modified)) newest={directory,modified};
    }
  }
  return newest?.directory;
}

export async function saveDialogDirectory(files:{lastPickedDirectory():Promise<string|undefined>}, gameId:string, options?:FolderOptions) {
  return await files.lastPickedDirectory() ?? await detectSaveDirectory(gameId,options);
}
