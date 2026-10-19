import { EventEmitter } from 'node:events';
import { beforeEach,expect,it,vi } from 'vitest';
import { LIMITS } from '@tavora/sdk/protocol';

const state=vi.hoisted(()=>({windows:[] as any[],sessions:[] as any[],partitions:[] as string[],hold:false,title:'Public guide',html:'<main>Public</main>',url:'https://public.test/guide',proxyClose:vi.fn()}));
vi.mock('./page-proxy',()=>({createPageProxy:async()=>({port:12345,close:state.proxyClose})}));
vi.mock('electron',()=>({
 session:{fromPartition:(partition:string)=>{
  const s=new EventEmitter() as any;s.webRequest={onBeforeRequest:vi.fn(fn=>s.before=fn),onHeadersReceived:vi.fn(fn=>s.headers=fn)};
  for(const name of ['setProxy','setPermissionRequestHandler','setPermissionCheckHandler','setDevicePermissionHandler','closeAllConnections','clearStorageData'])s[name]=vi.fn(async()=>{});
  state.sessions.push(s);state.partitions.push(partition);return s;
 }},
 BrowserWindow:class extends EventEmitter{
  destroyed=false;rejectLoad:((error:Error)=>void)|undefined;webContents:any;
  constructor(readonly options:any){super();this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=vi.fn();this.webContents.setWebRTCIPHandlingPolicy=vi.fn();this.webContents.executeJavaScript=vi.fn(async()=>({url:state.url,title:state.title,html:state.html}));state.windows.push(this);}
  async loadURL(){if(state.hold)return new Promise<void>((_resolve,reject)=>this.rejectLoad=reject);this.webContents.emit('did-navigate',{},state.url,200);}
  isDestroyed(){return this.destroyed;}
  destroy(){this.destroyed=true;this.rejectLoad?.(Error('closed'));}
 },
}));
import { moduleReadPage } from './page-import';
const policy={allowedHosts:()=>new Set(['public.test']),userAgent:'test'};
beforeEach(()=>{state.windows=[];state.sessions=[];state.partitions=[];state.hold=false;state.title='Public guide';state.html='<main>Public</main>';state.url='https://public.test/guide';state.proxyClose.mockClear();});
it('uses fresh hidden sandbox sessions, fixed capture only, and always cleans up',async()=>{
 for(let i=0;i<2;i++)expect(await moduleReadPage({url:state.url},policy,'module',new AbortController().signal)).toMatchObject({status:200,title:'Public guide'});
 expect(new Set(state.partitions).size).toBe(2);expect(state.partitions.every(p=>!p.startsWith('persist:'))).toBe(true);
 for(const win of state.windows){expect(win.options).toMatchObject({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webviewTag:false,webSecurity:true}});expect(win.options.webPreferences.preload).toBeUndefined();expect(win.destroyed).toBe(true);expect(win.webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp');}
 for(const s of state.sessions){expect(s.clearStorageData).toHaveBeenCalled();expect(s.closeAllConnections).toHaveBeenCalled();expect(s.setProxy).toHaveBeenCalledWith({proxyRules:'http://127.0.0.1:12345',proxyBypassRules:'<-loopback>'});}
 expect(state.proxyClose).toHaveBeenCalledTimes(2);
});
it('refuses arbitrary scripts, denied URLs, resource types and state-changing requests',async()=>{
 await expect(moduleReadPage({url:state.url,script:'anything'},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_PARAMS'});
 await expect(moduleReadPage({url:'https://denied.test/'},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'PERMISSION_DENIED'});
 expect(state.sessions).toHaveLength(0);
 await moduleReadPage({url:state.url},policy,'module',new AbortController().signal);
 const before=state.sessions[0].before;
 for(const details of [{url:'https://denied.test/',method:'GET',resourceType:'script'},{url:'http://public.test/',method:'GET',resourceType:'mainFrame'},{url:state.url,method:'GET',resourceType:'subFrame'},{url:state.url,method:'POST',resourceType:'xhr'},{url:state.url,method:'GET',resourceType:'image'}]){const callback=vi.fn();before(details,callback);expect(callback).toHaveBeenCalledWith({cancel:true});}
 const allowed=vi.fn();before({url:state.url,method:'GET',resourceType:'script'},allowed);expect(allowed).toHaveBeenCalledWith({cancel:false});
});
it('cancels on owner disconnect, rejects a concurrent import, and releases ownership',async()=>{
 state.hold=true;const controller=new AbortController();
 const pending=moduleReadPage({url:state.url},policy,'module',controller.signal);
 const rejected=expect(pending).rejects.toMatchObject({code:'NETWORK_ERROR'});
 await vi.waitFor(()=>expect(state.windows).toHaveLength(1));
 await expect(moduleReadPage({url:state.url},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'BAD_REQUEST'});
 controller.abort();await rejected;
 expect(state.windows[0].destroyed).toBe(true);expect(state.sessions[0].clearStorageData).toHaveBeenCalled();
 state.hold=false;await expect(moduleReadPage({url:state.url},policy,'module',new AbortController().signal)).resolves.toMatchObject({status:200});
});
it('rejects challenge pages, oversized HTML and final URLs outside the grant',async()=>{
 state.title='Just a moment…';await expect(moduleReadPage({url:state.url},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'NETWORK_ERROR'});
 state.title='Public guide';state.html='x'.repeat(LIMITS.maxNetworkResponseBytes+1);await expect(moduleReadPage({url:state.url},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'QUOTA_EXCEEDED'});
 state.html='small';state.url='https://denied.test/';await expect(moduleReadPage({url:'https://public.test/guide'},policy,'module',new AbortController().signal)).rejects.toMatchObject({code:'PERMISSION_DENIED'});
 expect(state.windows.every(w=>w.destroyed)).toBe(true);
});
