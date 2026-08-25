/**
 * vitest 最小配置：node 环境，仅覆盖 core/ 与 services/mock 的纯 TS 单测。
 * 不配置浏览器/React 测试（原型阶段约束）。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['core/**/*.test.ts', 'services/**/*.test.ts'],
  },
})
