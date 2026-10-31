import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findSteamDir } from './steam-icons';

interface FolderOptions { home?:string; platform?:NodeJS.Platform; steamDirectory?:string|null; localAppData?:string }
interface Candidate { directory:string; save:RegExp }

/** Bounded game-specific hints only; detection grants no file or directory access. */
export async function detectSaveDirectory(gameId:string, options:FolderOptions = {}):Promise<string|undefined> {
  const candidates = gameId === 'enshrouded' ? await enshrouded(options) : gameId === 'palworld' ? await palworld(options) : [];
  let newest:{directory:string;modified:number}|undefined;
  for (const {directory,save} of candidates) {
    const files=await readdir(directory,{withFileTypes:true}).catch(()=>[]);
    for (const file of files.filter(f=>f.isFile() && save.test(f.name)).slice(0,200)) {
      const modified=(await stat(path.join(directory,file.name)).catch(()=>null))?.mtimeMs;
      if (modified !== undefined && (!newest || modified > newest.modified)) newest={directory,modified};
    }
  }
  return newest?.directory;
}

async function enshrouded(options:FolderOptions):Promise<Candidate[]> {
  const candidates:Candidate[] = [], home=options.home ?? os.homedir(), save=/^(character|world)\d+\.ksd$/i;
  if ((options.platform ?? process.platform) === 'win32') candidates.push({directory:path.join(home,'Saved Games','keen games','Enshrouded','default'),save});
  const steam=options.steamDirectory === undefined ? await findSteamDir() : options.steamDirectory;
  if (steam) {
    const accounts=await readdir(path.join(steam,'userdata'),{withFileTypes:true}).catch(()=>[]);
    for (const account of accounts.filter(a=>a.isDirectory() && /^\d+$/.test(a.name)).slice(0,200)) candidates.push({directory:path.join(steam,'userdata',account.name,'1203620','remote'),save});
  }
  return candidates;
}

/** Palworld (Steam): %LOCALAPPDATA%\Pal\Saved\SaveGames\<Steam id>\<world>\Players, which holds the player saves. */
async function palworld(options:FolderOptions):Promise<Candidate[]> {
  if ((options.platform ?? process.platform) !== 'win32') return [];
  const local=options.localAppData ?? process.env.LOCALAPPDATA ?? path.join(options.home ?? os.homedir(),'AppData','Local');
  const root=path.join(local,'Pal','Saved','SaveGames'), candidates:Candidate[] = [], save=/^[0-9a-f]{32}\.sav$/i;
  const accounts=await readdir(root,{withFileTypes:true}).catch(()=>[]);
  for (const account of accounts.filter(a=>a.isDirectory() && /^\d+$/.test(a.name)).slice(0,20)) {
    const worlds=await readdir(path.join(root,account.name),{withFileTypes:true}).catch(()=>[]);
    for (const world of worlds.filter(w=>w.isDirectory() && /^[0-9a-f]{32}$/i.test(w.name)).slice(0,100)) candidates.push({directory:path.join(root,account.name,world.name,'Players'),save});
  }
  return candidates;
}

export async function saveDialogDirectory(files:{lastPickedDirectory():Promise<string|undefined>}, gameId:string, options?:FolderOptions) {
  return await files.lastPickedDirectory() ?? await detectSaveDirectory(gameId,options);
}
