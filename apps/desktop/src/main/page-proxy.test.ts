import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { afterEach,expect,it,vi } from 'vitest';
import { createPageProxy } from './page-proxy';

vi.mock('node:dns/promises',()=>({lookup:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());
async function request(port:number,request:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({host:'127.0.0.1',port});let answer='';
  socket.once('connect',()=>socket.write(request));socket.on('data',chunk=>{answer+=chunk.toString();if(answer.includes('\r\n\r\n'))socket.end();});
  socket.once('error',reject);socket.once('close',()=>resolve(answer));
 });
}
it('rejects non-CONNECT requests, ungranted hosts, custom ports and private DNS answers',async()=>{
 const abort=new AbortController(),proxy=await createPageProxy({allowedHosts:()=>new Set(['public.test']),userAgent:'test'},abort.signal);
 try{
  expect(await request(proxy.port,'GET http://public.test/ HTTP/1.1\r\nHost: public.test\r\nConnection: close\r\n\r\n')).toContain('403');
  for(const authority of ['evil.test:443','public.test:8443','127.0.0.1:443','user@public.test:443'])expect(await request(proxy.port,`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)).not.toContain('200');
  for(const address of ['127.0.0.1','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1']){
   vi.mocked(lookup).mockResolvedValue([{address,family:net.isIP(address)}] as never);
   expect(await request(proxy.port,'CONNECT public.test:443 HTTP/1.1\r\nHost: public.test\r\n\r\n')).toBe('');
  }
 }finally{proxy.close();}
});
it('pins the checked IP into the connection and rechecks a grant revoked during DNS',async()=>{
 let granted=true;const abort=new AbortController(),proxy=await createPageProxy({allowedHosts:()=>new Set(granted?['public.test']:[]),userAgent:'test'},abort.signal);
 try{
  vi.mocked(lookup).mockImplementation(async()=>{granted=false;return [{address:'1.1.1.1',family:4}] as never;});
  const connect=vi.spyOn(net,'connect');
  expect(await request(proxy.port,'CONNECT public.test:443 HTTP/1.1\r\nHost: public.test\r\n\r\n')).toBe('');
  expect(connect).not.toHaveBeenCalled();
  granted=true;vi.mocked(lookup).mockResolvedValue([{address:'1.1.1.1',family:4}] as never);
  connect.mockImplementation((()=>{const socket=new net.Socket();queueMicrotask(()=>socket.destroy());return socket;}) as typeof net.connect);
  await request(proxy.port,'CONNECT public.test:443 HTTP/1.1\r\nHost: public.test\r\n\r\n');
  expect(connect).toHaveBeenCalledWith({host:'1.1.1.1',port:443});
 }finally{proxy.close();}
});
it('closes open proxy connections when its owner disconnects',async()=>{
 const abort=new AbortController(),proxy=await createPageProxy({allowedHosts:()=>new Set(),userAgent:'test'},abort.signal);
 const socket=net.createConnection({host:'127.0.0.1',port:proxy.port});
 await new Promise<void>(resolve=>socket.once('connect',resolve));
 const closed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));abort.abort();await closed;proxy.close();
 expect(socket.destroyed).toBe(true);
});
