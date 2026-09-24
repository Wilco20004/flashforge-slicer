import { defineConfig } from 'vite';

/**
 * Bundles the failure watcher into one file for the container.
 *
 * Everything is inlined (`noExternal`) so the runtime image needs node and this
 * file, and no node_modules tree — the web app's own dependencies have no
 * business being installed next to nginx.
 */
export default defineConfig({
  build: {
    outDir: 'dist-watch',
    emptyOutDir: true,
    ssr: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      input: 'src/watch/main.ts',
      output: { entryFileNames: 'watcher.mjs', format: 'es' },
    },
  },
  ssr: { noExternal: true },
});
