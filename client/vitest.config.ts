import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    // core/ 为平台无关纯 TS，直接在 node 环境单测（见架构文档 §2.1）
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
