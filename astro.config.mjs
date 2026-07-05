import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// 静态输出 + Vercel 适配器：所有页面预渲染，只有 /api/check 是 serverless function
export default defineConfig({
  output: 'static',
  adapter: vercel(),
  site: 'https://claude-safe.vercel.app',
  vite: {
    optimizeDeps: { exclude: ['systeminformation'] },
  },
});
