import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': r('./src'), '@shared': r('./shared') } },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    // node_modules may be a symlink (git worktrees); allow its real location
    fs: { allow: ['.', realpathSync(r('./node_modules'))] },
    proxy: {
      '/api': process.env.API_URL ?? 'http://localhost:4000',
      '/socket.io': { target: process.env.API_URL ?? 'http://localhost:4000', ws: true },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'shared/**/*.test.ts'] },
} as any);
