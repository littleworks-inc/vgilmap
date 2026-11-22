/**
 * Local stand-in for Vercel's functions: serves everything in api/ (including api/v1/*) on
 * http://127.0.0.1:8787 so `npm run dev` has the same /api/* routes as production.
 *
 *   terminal 1:  npm run dev:api
 *   terminal 2:  npm run dev        (Vite proxies /api to this server)
 *
 * Secrets come from .env.local (see .env.example); sources whose key is missing report an error
 * in Data Health instead of breaking the rest.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api');
const PORT = Number(process.env.DEV_API_PORT ?? 8787);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const name = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    const file = path.join(ROOT, `${name}.ts`);
    // Never serve api/_lib/*, and never escape api/.
    if (!name || name.startsWith('_') || name.includes('/_') || !file.startsWith(ROOT) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('no such function');
    }
    const mod = await import(`${file}?t=${Date.now()}`); // fresh import so edits show up without a restart
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
    const r: Response = await mod.default(new Request(url, {
      method: req.method, headers: req.headers as Record<string, string>, body: hasBody ? Buffer.concat(chunks) : undefined,
    }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`dev api on http://127.0.0.1:${PORT}`));
