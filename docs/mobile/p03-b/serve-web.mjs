import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../mobile/p03-b/rn/dist-web/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.wasm':'application/wasm','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf'};
createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-store');
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const target=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!target.startsWith(resolve(root)+sep)) {res.writeHead(403);res.end();return;}
    if(!(await stat(target)).isFile()) throw new Error();
    res.setHeader('Content-Type',mime[extname(target)]??'application/octet-stream');res.end(await readFile(target));
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(4175,'127.0.0.1',()=>console.log('P03-B web-only SQLite probe http://127.0.0.1:4175'));
