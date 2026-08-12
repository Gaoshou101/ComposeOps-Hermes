import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发环境通过代理转发到后端 Fastify（默认 3001）
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
