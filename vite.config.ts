import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // The API runs separately (server/); same-origin requests keep the session cookie simple.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  test: { environment: 'node' },
});
