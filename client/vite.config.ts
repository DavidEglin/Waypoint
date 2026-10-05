import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: run the server with ALLOWED_HOST=localhost:5173 COOKIE_SECURE=false so the proxy passes the host lock.
export default defineConfig({
  plugins: [react()],
  // changeOrigin: false - the string shorthand defaults it to true, which rewrites the Host header
  // to the target and trips the server's host lock (ALLOWED_HOST=localhost:5173).
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false },
});
