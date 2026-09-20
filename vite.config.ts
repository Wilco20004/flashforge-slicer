import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully static build: everything (slicing included) runs in the browser.
export default defineConfig({
  plugins: [react()],
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
