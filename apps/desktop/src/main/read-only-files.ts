import { randomBytes } from 'node:crypto';
import { open, readFile, realpath, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isGameId, isModuleId, isOwnerId } from '@tavora/module-schema';
import { HostError } from './errors';
import { writeFileAtomic } from './fsutil';
import type { ReadOnlyFile, ReadOnlyFileState } from '@tavora/sdk/protocol';

export const READ_ONLY_FILES_DIR = 'read-only-files';
export const MAX_READ_ONLY_BYTES = 50 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;
type Entry = { path: string; target: string; name: string };
const queues = new Map<string, Promise<unknown>>();
const reads = new Map<string,number>();
let activeReads = 0;
/** File authority stays on this PC, outside the user's backed-up module data. */
export class ReadOnlyFiles {
  private file: string;
  constructor(userData: string, owner: string, moduleId: string, gameId: string) {
    if (!isOwnerId(owner) || !isModuleId(moduleId) || !isGameId(gameId)) throw Error('Invalid file scope');
    this.file = path.join(userData, READ_ONLY_FILES_DIR, owner, moduleId, gameId, 'sources.json');
  }
  /** A local picker hint, never file authority and never returned to a module. */
  async lastPickedDirectory(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(path.join(path.dirname(this.file), 'picker.json'), 'utf8'));
      if (typeof value.directory === 'string' && path.isAbsolute(value.directory) && (await stat(value.directory)).isDirectory()) return value.directory;
    } catch { /* Missing or stale hints fall back to the folders of this workspace's files. */ }
    const entries = await this.entries().catch(() => ({} as Record<string, Entry>));
    for (const entry of Object.values(entries).reverse()) {
      const directory = path.dirname(entry.path);
      if ((await stat(directory).catch(() => null))?.isDirectory()) return directory;
    }
    return undefined;
  }
  private async entries(): Promise<Record<string, Entry>> {
    try {
      const entries = JSON.parse(await readFile(this.file, 'utf8'));
      if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.entries(entries).some(([id,e]: [string,any]) => !ID.test(id) || !e || typeof e.path !== 'string' || !path.isAbsolute(e.path) || typeof e.target !== 'string' || !path.isAbsolute(e.target) || typeof e.name !== 'string')) throw Error('Invalid file references');
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new HostError('INTERNAL', 'Saved file access is unavailable. Choose your files again.');
    }
  }
  private async update<T>(change: (entries: Record<string,Entry>) => Promise<T>, recover = false): Promise<T> {
    const next = (queues.get(this.file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const entries = await this.entries().catch(error=>{if(!recover)throw error;return {} as Record<string,Entry>;});
      const result = await change(entries);
      await mkdir(path.dirname(this.file), {recursive:true});
      await writeFileAtomic(this.file, JSON.stringify(entries));
      return result;
    });
    queues.set(this.file,next);
    try { return await next; } finally { if (queues.get(this.file) === next) queues.delete(this.file); }
  }
  /** Called only with a path returned directly by Tavora's native picker. */
  async remember(selected: string, allowed: () => boolean = () => true): Promise<ReadOnlyFile> {
    const absolute = path.resolve(selected), target = await realpath(absolute);
    const entry = {path:absolute,target,name:path.basename(absolute)};
    const bytes = await this.bytes(entry);
    return this.update(async entries => {
      if (!allowed()) throw new HostError('PERMISSION_DENIED','The file picker is no longer active.');
      if (Object.keys(entries).length >= 200) throw new HostError('QUOTA_EXCEEDED','Too many remembered files. Forget an unused file first.');
      const id = randomBytes(16).toString('hex'); entries[id] = entry;
      await mkdir(path.dirname(this.file), {recursive:true});
      await writeFileAtomic(path.join(path.dirname(this.file), 'picker.json'), JSON.stringify({directory:path.dirname(absolute)}));
      return {id,name:entry.name,size:bytes.byteLength};
    },true);
  }
  async read(id: string): Promise<Buffer> {
    if (!ID.test(id)) throw new HostError('INVALID_PARAMS','Invalid file reference.');
    const active=reads.get(this.file)??0;
    if(active>=2 || activeReads>=4) throw new HostError('QUOTA_EXCEEDED','Files are already being read. Try again.');
    reads.set(this.file,active+1);activeReads++;
    try {
      const entry=(await this.entries())[id];
      if(!entry)throw new HostError('BAD_REQUEST','This file is no longer linked. Choose it again.');
      return await this.bytes(entry);
    } catch(error) {
      if(error instanceof HostError)throw error;
      throw new HostError('BAD_REQUEST',"Can't read this file. It may have moved. Choose it again.");
    } finally {
      activeReads--;const count=(reads.get(this.file)??1)-1;
      if(count)reads.set(this.file,count);else reads.delete(this.file);
    }
  }
  private async bytes(entry: Entry): Promise<Buffer> {
    if (await realpath(entry.path) !== entry.target) throw new HostError('PERMISSION_DENIED','This file now points somewhere else. Choose it again.');
    const handle = await open(entry.path,'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HostError('INVALID_PARAMS','Choose a file, not a folder.');
      if (stat.size > MAX_READ_ONLY_BYTES) throw new HostError('QUOTA_EXCEEDED','Choose a file smaller than 50 MB.');
      const bytes = Buffer.alloc(stat.size + 1);
      let size = 0;
      while (size < bytes.length) { const part = await handle.read(bytes,size,bytes.length-size,size); if (!part.bytesRead) break; size += part.bytesRead; }
      if (size !== stat.size || (await handle.stat()).mtimeMs !== stat.mtimeMs || await realpath(entry.path) !== entry.target) throw new HostError('BAD_REQUEST','The file changed while being read. Try again after saving your game.');
      return bytes.subarray(0,size);
    } finally { await handle.close(); }
  }
  /** Whether a remembered file is still where it was, with its size and last change; never reads it. */
  async check(id: string): Promise<ReadOnlyFileState> {
    if (!ID.test(id)) throw new HostError('INVALID_PARAMS','Invalid file reference.');
    const entry=(await this.entries())[id];
    if(!entry)return {found:false,reason:'unlinked'};
    const stat=await this.located(entry);
    return stat?{found:true,size:stat.size,modifiedAt:Math.floor(stat.mtimeMs)}:{found:false,reason:'gone'};
  }
  /** The place of a remembered file that is still there, for Tavora to show in its folder. Never given to a module. */
  async locate(id: string): Promise<string> {
    if (!ID.test(id)) throw new HostError('INVALID_PARAMS','Invalid file reference.');
    const entry=(await this.entries())[id];
    if(!entry)throw new HostError('BAD_REQUEST','This file is no longer linked. Choose it again.');
    if(!await this.located(entry))throw new HostError('BAD_REQUEST',"Can't find this file. It may have moved.");
    return entry.path;
  }
  /** The file's details while it is still the file that was picked, else null (gone, moved or now pointing elsewhere). */
  private async located(entry: Entry) {
    try {
      if (await realpath(entry.path) !== entry.target) return null;
      const found=await stat(entry.path);
      return found.isFile()?found:null;
    } catch { return null; }
  }
  async forget(id: string): Promise<void> {
    if (!ID.test(id)) throw new HostError('INVALID_PARAMS','Invalid file reference.');
    await this.update(async entries => { delete entries[id]; });
  }
}
