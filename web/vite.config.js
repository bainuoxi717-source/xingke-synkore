import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3911,
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3930' },
  },
  build: { outDir: 'dist' },
});
