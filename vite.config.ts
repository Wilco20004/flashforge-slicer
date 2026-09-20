import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only twin of the nginx printer relay (see nginx.conf). */
function printerRelay(): Plugin {
  return {
    name: 'printer-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === '/relay-status') {
          res.statusCode = 204;
          res.setHeader('X-Printer-Relay', '1');
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// Fully static build: everything (slicing included) runs in the browser.
export default defineConfig({
  plugins: [react(), printerRelay()],
  base: './',
  server: {
    proxy: {
      '^/printer/': {
        target: 'http://127.0.0.1:8898',
        changeOrigin: true,
        router: (req) => {
          const m = /^\/printer\/([^/]+)/.exec(req.url ?? '');
          return m ? `http://${m[1]}` : 'http://127.0.0.1:8898';
        },
        rewrite: (path) => path.replace(/^\/printer\/[^/]+/, ''),
      },
    },
  },
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
