import http from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only twin of the nginx printer relay and settings store (see nginx.conf). */
function printerRelay(): Plugin {
  return {
    name: 'printer-relay',
    configureServer(server) {
      let settings = '';
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path === '/relay-status') {
          res.statusCode = 204;
          res.setHeader('X-Printer-Relay', '1');
          res.setHeader('X-Settings-Store', '1');
          res.end();
          return;
        }
        if (path === '/settings.json') {
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => { settings = body; res.statusCode = 204; res.end(); });
            return;
          }
          if (req.method === 'GET') {
            res.statusCode = settings ? 200 : 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(settings);
            return;
          }
        }
        // /printer/<host>[:port]/<path>?<query>  ->  http://<host>:<port>/<path>?<query>  (streams both ways)
        const m = /^\/printer\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(req.url ?? '');
        if (m) {
          const upstream = http.request(
            { host: m[1], port: Number(m[2] ?? 8898), method: req.method, path: m[3] || '/', headers: { ...req.headers, host: `${m[1]}:${m[2] ?? 8898}` } },
            (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
          );
          upstream.on('error', (err) => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/html' }); res.end(`<h1>502 relay</h1><p>${err.message}</p>`); });
          res.on('close', () => upstream.destroy());
          req.pipe(upstream);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), printerRelay()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);
