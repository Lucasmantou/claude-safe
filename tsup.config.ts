import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['cli/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  platform: 'node',
  clean: true,
  splitting: false,
  // 把 systeminformation 一起打进来，单文件分发
  noExternal: ['systeminformation'],
  // systeminformation 是 CJS，注入 createRequire shim 让 ESM bundle 能 require Node 内置模块
  banner: {
    js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
  },
});
