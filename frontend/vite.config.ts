import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        // use the shared package source directly (no build step needed in dev)
        '@silkgrade/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
      },
    },
    server: {
      port: Number(env.VITE_PORT ?? 5173),
      host: true,
      proxy: { '/api': { target: env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: true } },
    },
    build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
