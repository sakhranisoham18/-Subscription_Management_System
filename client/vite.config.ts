import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    // In development the API is proxied, so the refresh cookie is same-origin.
    proxy: { '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000', changeOrigin: true } },
  },
});
