/**
 * 入口：加载 env → 装配 → 监听；SIGINT/SIGTERM 优雅关闭。
 */

import { loadEnv } from './config/env'
import { buildApp } from './app'

const env = loadEnv()
const app = await buildApp(env)

await app.listen({ port: env.PORT, host: env.HOST })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.log.info({ signal: sig }, 'shutting down')
    void app.close().then(() => process.exit(0))
  })
}
