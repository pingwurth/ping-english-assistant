/**
 * vitest 最小配置：node 环境，覆盖 core/ 与 services/ 的纯 TS 单测
 * + platform/（recorder/html-player/存储）、lib/（server-settings 等）、stores/、
 * app/api/ 的纯函数级单测（BFF 处理器 import 函数直测，不起 Next 服务）。
 * 不配置浏览器/React 组件测试（原型阶段约束）。
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
    include: [
      'core/**/*.test.ts',
      'services/**/*.test.ts',
      'platform/**/*.test.ts',
      'lib/**/*.test.ts',
      'stores/**/*.test.ts',
      'app/api/**/*.test.ts',
    ],
  },
})
