from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT/'dist'),**kw)
 def do_GET(self):
  if self.path=='/':data=(ROOT/'test/host.html').read_bytes();mime='text/html'
  elif self.path=='/bridge.js':data=(ROOT/'test/bridge.js').read_bytes();mime='text/javascript'
  elif self.path.startswith('/panel?'):data=(ROOT/'dist/index.html').read_bytes().replace(b'<head>',b'<head><script src="/bridge.js"></script>');mime='text/html'
  else:return super().do_GET()
  self.send_response(200);self.send_header('Content-Type',mime+'; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
if __name__=='__main__':
 import sys
 ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 4190),Handler).serve_forever()
