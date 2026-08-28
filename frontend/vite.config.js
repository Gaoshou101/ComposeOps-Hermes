import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发环境通过代理转发到后端 Fastify(默认 3001)
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
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
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit'],
          'vue-vendor': ['vue', 'vue-router', 'pinia', 'lucide-vue-next'],
        },
      },
    },
  },
});
