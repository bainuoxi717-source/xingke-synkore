import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  define: mode === 'public-demo' ? { 'import.meta.env.VITE_PUBLIC_DEMO': JSON.stringify('1') } : {},
  plugins: [react()],
  server: {
    port: 3911,
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3930' },
  },
  build: { outDir: 'dist' },
}));
