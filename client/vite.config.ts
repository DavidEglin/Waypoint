import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: run the server with ALLOWED_HOST=localhost:5173 COOKIE_SECURE=false so the proxy passes the host lock.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: false },
});
