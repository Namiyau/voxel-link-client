import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const requestedRoot = process.argv[2] || '.';
const root = path.resolve(process.cwd(), requestedRoot);
const port = Math.max(1, Math.min(65535, Number(process.argv[3]) || 8080));
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) && target !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const stat = await fs.stat(target);
    const finalPath = stat.isDirectory() ? path.join(target, 'index.html') : target;
    const data = await fs.readFile(finalPath);
    res.writeHead(200, {
      'content-type': mime.get(path.extname(finalPath).toLowerCase()) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`纯客户端本地地址: http://127.0.0.1:${port}`);
  console.log('请保持本窗口开启；按 Ctrl+C 停止。');
});
