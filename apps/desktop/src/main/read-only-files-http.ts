import type { ReadOnlyFiles } from './read-only-files';
import { HostError } from './errors';
export async function serveReadOnlyFile(request: Request, id: string, files: Pick<ReadOnlyFiles,'read'>): Promise<Response> {
  const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
  if (request.method !== 'POST') return new Response(null,{status:405,headers});
  try { return new Response(new Uint8Array(await files.read(id)),{headers:{...headers,'Content-Type':'application/octet-stream'}}); }
  catch (error) {
    const known = error instanceof HostError;
    return Response.json({error:{code:known?error.code:'INTERNAL',message:known?error.message:'Could not read this file.'}},{status:known && error.code==='BAD_REQUEST'?404:400,headers});
  }
}
