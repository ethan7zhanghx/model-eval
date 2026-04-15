import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const port = Number(process.env.LOCAL_EVAL_PORT || 4310);
const webEntry = resolve(process.cwd(), 'src/web/index.html');

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'local-eval-dev' }));
    return;
  }

  try {
    const html = await readFile(webEntry, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(error) }));
  }
});

server.listen(port, '127.0.0.1', () => {
  // Keep output explicit so desktop shell can parse readiness.
  console.log(`[local-eval] dev server ready at http://127.0.0.1:${port}`);
});
